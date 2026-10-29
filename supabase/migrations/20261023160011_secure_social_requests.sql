-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — migration 003: the social graph (friend requests → accepted).
--
-- Restore the existing social contract; only ownership-checked RPCs mutate friendships.
--
-- THE MODEL
--   One row per directed edge: (user_id, friend_un). A friendship between
--   `aarav` and `zoya` is TWO rows that must agree —
--     aarav→zoya: status accepted          zoya→aarav: status accepted
--   A pending request is ONE row created by the requester (status 'pending');
--   the recipient never gets a pending row pointed at themselves, so there is
--   exactly one place to look for incoming requests: rows where friend_un is
--   me and... no. Incoming requests need the RECIPIENT's own user_id row to
--   read under RLS, so accept_request() (below) CREATES the mirror row owned
--   by the recipient. Before acceptance the recipient simply cannot see the
--   request — which is why accept flows through the SECURITY DEFINER RPC.
--
-- PRIVACY
--   profiles.un is public (leaderboard already shows it). Nobody can read
--   another user's tasks, sessions, rules or integration rows — the existing
--   owner-only RLS is untouched. The public aggregate (friend_feed) exposes
--   only: username, display name, focus minutes, active days, streak — the
--   same numbers the leaderboard already publishes by product design.
-- ══════════════════════════════════════════════════════════════════════════


-- ── 1. allow recipients to see incoming pending requests ─────────────────
-- The request lives as a row owned by the REQUESTER (user_id = them). The
-- recipient must be able to READ it to learn they were asked. This SELECT
-- policy adds exactly that: my own rows, plus rows that point at my username.
drop policy if exists friends_own on public.friends;
create policy friends_own on public.friends
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists friends_incoming_read on public.friends;
create policy friends_incoming_read on public.friends
  for select
  using (
    status = 'pending'
    and friend_un = (select p.un from public.profiles p where p.id = auth.uid())
  );

-- ── 2. accept / reject / cancel through one SECURITY DEFINER RPC ──────────
-- RLS alone cannot enforce the reciprocity rule (accepting must create the
-- recipient-owned mirror row). One definer function, ownership checked
-- inside, does all three actions atomically.
create or replace function public.friend_action(
  p_requester_un text,
  p_action       text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me        public.profiles%rowtype;
  requester public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'no profile'; end if;

  if p_action not in ('accept', 'reject', 'cancel', 'remove', 'request') then
    raise exception 'invalid action';
  end if;

  select * into requester from public.profiles where un = p_requester_un;
  if requester.id is null or requester.id = me.id then
    raise exception 'unknown user';
  end if;

  if p_action = 'request' then
    -- A request from me to them: one pending row I own.
    insert into public.friends (user_id, friend_un, status, privacy)
    values (me.id, requester.un, 'pending', 'stats')
    on conflict (user_id, friend_un) do update
      set status = 'pending', created_at = now()
      where public.friends.status = 'rejected';
    return 'pending';
  end if;

  if p_action = 'cancel' then
    -- I withdraw MY pending request to them.
    delete from public.friends
    where user_id = me.id and friend_un = requester.un and status = 'pending';
    return 'cancelled';
  end if;

  if p_action = 'accept' then
    -- They must have a pending request pointed at my username.
    if not exists (
      select 1 from public.friends
      where user_id = requester.id and friend_un = me.un and status = 'pending'
    ) then raise exception 'no pending request'; end if;
    -- Both directions become accepted (creates my mirror row).
    update public.friends set status = 'accepted'
    where user_id = requester.id and friend_un = me.un;
    insert into public.friends (user_id, friend_un, status, privacy)
    values (me.id, requester.un, 'accepted', 'stats')
    on conflict (user_id, friend_un) do update set status = 'accepted';
    return 'accepted';
  end if;

  if p_action = 'reject' then
    delete from public.friends
    where user_id = requester.id and friend_un = me.un and status = 'pending';
    return 'rejected';
  end if;

  -- remove: delete both directions.
  if p_action = 'remove' then
    if not exists (
      select 1 from public.friends
      where user_id = me.id and friend_un = requester.un and status = 'accepted'
    ) then raise exception 'not friends'; end if;
    delete from public.friends
    where (user_id = me.id and friend_un = requester.un)
       or (user_id = requester.id and friend_un = me.un);
    return 'removed';
  end if;

  raise exception 'unreachable';
end; $$;

revoke execute on function public.friend_action(text, text) from anon, public;
grant execute on function public.friend_action(text, text) to authenticated;

-- ── 3. the public aggregate: what friends may see of each other ───────────
-- Intentionally the SAME numbers the leaderboard publishes (focus minutes,
-- active days, last active) — nothing private ever crosses this boundary.
-- Scoped to the caller's accepted friends only, so it is a friends view of
-- public data, not a general probe.
create or replace function public.friend_feed()
returns table (un text, name text, focus_minutes bigint, active_days bigint, last_active date)
language sql
security definer
set search_path = ''
stable
as $$
  with mine as (
    -- My accepted edges, resolved to profile ids.
    select f.friend_un
    from public.friends f
    where f.user_id = auth.uid() and f.status = 'accepted'
  )
  select
    p.un, p.name,
    coalesce(sum(d.focus_s), 0) / 60        as focus_minutes,
    count(d.day) filter (where d.focus_s > 0) as active_days,
    coalesce(max(d.day), current_date)       as last_active
  from public.profiles p
  left join public.daily_focus d on d.user_id = p.id
  where p.un in (select friend_un from mine)
  group by p.id, p.un, p.name
  order by focus_minutes desc, p.un asc;
$$;

revoke execute on function public.friend_feed() from anon, public;
grant execute on function public.friend_feed() to authenticated;

-- ── confirm ───────────────────────────────────────────────────────────────
select proname, proconfig from pg_proc where proname in ('friend_action', 'friend_feed');
select policyname, cmd from pg_policies where tablename = 'friends';


revoke insert, update, delete on public.friends from anon, authenticated;
grant select on public.friends to authenticated;
create or replace function public.friend_requests()
returns table (un text, direction text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select p.un, case when f.user_id = auth.uid() then 'outgoing' else 'incoming' end, f.created_at
  from public.friends f
  join public.profiles me on me.id = auth.uid()
  join public.profiles p on p.id = case when f.user_id = me.id
    then (select target.id from public.profiles target where target.un = f.friend_un) else f.user_id end
  where f.status = 'pending' and (f.user_id = me.id or f.friend_un = me.un);
$$;
revoke execute on function public.friend_requests() from public, anon;
grant execute on function public.friend_requests() to authenticated;
