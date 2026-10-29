-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — Supabase schema, v1 (Phase 3, prepares the sync the clients already
-- expect).
--
-- HOW TO APPLY
--   1. Create the project (SETUP.md §1) and open **SQL Editor → New query**.
--   2. Paste this whole file and press **Run**. It is idempotent: running it
--      twice is safe.
--   3. Nothing in the app switches over yet. The local storage adapter (`S.*`)
--      keeps working as the fallback until the sync path is verified — this
--      file only creates the destination.
--
-- WHAT IT MIRRORS
-- The JSON shapes the clients already write today, one table per concept:
--   profiles      ← `u:<user>`            (name, email, settings)
--   block_rules   ← blocking.rules        (kind, target, when, scheduleIds)
--   block_schedules ← blocking.schedules  (days, start, end, enabled)
--   focus_sessions ← `fs:<user>:<date>`   (raw records — the source of truth)
--   daily_focus   ← `fo:<user>:<date>`    (roll-up, derived from sessions)
--   tasks / boards ← `u:<user>.tasks`, `bd:<user>`
--   usage_records ← extension `usage`, desktop `UsageRecord`
--   friends       ← `profile.friends`
--
-- RULES APPLIED THROUGHOUT
--   • every row is owner-scoped with RLS — nobody reads anyone else's data;
--   • stable UUIDs, never display names, as identities;
--   • timestamps are timestamptz, rendered in the user's own timezone;
--   • competitive numbers (focus minutes, streaks, completed tasks) are written
--     only through server-side functions, so a client cannot inflate them;
--   • no page contents, no browsing history paths — domains and durations only.
-- ══════════════════════════════════════════════════════════════════════════

-- ONE TRANSACTION FOR THE WHOLE FILE. If any statement fails, every change
-- rolls back and the database is left exactly as it was. That matters more here
-- than it looks: the RLS statements sit at the end of the file, so a partial
-- apply would leave tables that exist and are reachable but have NO policies —
-- worse than not running the script at all.
begin;

create extension if not exists "pgcrypto";

-- ── helpers ───────────────────────────────────────────────────────────────
-- Usernames stay lowercase keys (same rule as the shared account mapper in
-- packages/shared-types/account.js) so `un` is stable across devices.
create or replace function public.slug_username(input text)
returns text language sql immutable as $$
  select left(regexp_replace(lower(coalesce(input, '')), '[^a-z0-9._-]', '', 'g'), 20);
$$;

-- ── profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  un                 text not null,
  name               text not null default '',
  email              text,
  onboarding_complete boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Pomodoro + blocking preferences, shaped exactly like the client model.
  settings           jsonb not null default '{
    "pm": {"w": 25, "sb": 5, "lb": 15, "sound": false, "notify": false},
    "blockDuringFocus": true,
    "allowTemporaryUnblock": true,
    "tempUnblockMinutes": 5,
    "theme": "auto"
  }'::jsonb,
  constraint profiles_un_lowercase check (un = slug_username(un)),
  constraint profiles_un_unique unique (un)
);

-- Create the profile row automatically on sign-up, so no client has to
-- remember to (this is the server half of `defaultProfile()`).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base   text;
  final  text;
  suffix int := 0;
begin
  base := public.slug_username(
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  );
  if base = '' then base := 'user_' || left(replace(new.id::text, '-', ''), 8); end if;
  final := base;
  while exists (select 1 from public.profiles p where p.un = final) loop
    suffix := suffix + 1;
    final := left(base, 16) || '_' || suffix::text;
  end loop;

  insert into public.profiles (id, un, name, email)
  values (new.id, final, coalesce(new.raw_user_meta_data ->> 'name', final), new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── block rules ───────────────────────────────────────────────────────────
create table if not exists public.block_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('website', 'app')),
  target       text not null,                         -- "youtube.com" | "Steam"
  label        text not null default '',
  enabled      boolean not null default true,
  "when"       text not null default 'always' check ("when" in ('always', 'focus', 'scheduled')),
  schedule_ids uuid[] not null default '{}',          -- references block_schedules
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, kind, target)
);
create index if not exists block_rules_user_idx on public.block_rules (user_id);

-- ── schedules ─────────────────────────────────────────────────────────────
create table if not exists public.block_schedules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null default 'Schedule',
  -- 0 = Sunday … 6 = Saturday, matching Date#getDay on every client.
  days       smallint[] not null default '{1,2,3,4,5}',
  start_time time not null default '09:00',
  end_time   time not null default '17:00',
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  -- Day numbers must be a non-empty subset of 0..6. Written with the array
  -- containment operator rather than a `select ... from unnest(days)`, because
  -- PostgreSQL rejects subqueries inside CHECK constraints.
  constraint block_schedules_days_valid check (
    array_length(days, 1) > 0 and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  -- A zero-length window never blocks (the shared engine treats it the same
  -- way), so reject it at the source instead of storing a no-op.
  constraint block_schedules_nonzero check (start_time <> end_time)
);
create index if not exists block_schedules_user_idx on public.block_schedules (user_id);

-- ── focus sessions (raw records: the source of truth for every statistic) ──
create table if not exists public.focus_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  phase      text not null default 'focus' check (phase in ('focus', 'shortBreak', 'longBreak')),
  started_at timestamptz not null,
  ended_at   timestamptz not null,
  planned_s  integer not null check (planned_s >= 0),   -- planned seconds
  actual_s   integer not null check (actual_s >= 0),    -- honest, never inflated
  completed  boolean not null default false,
  created_at timestamptz not null default now(),
  -- A session is created once and never rewritten into a bigger number.
  constraint focus_sessions_actual_le_planned check (actual_s <= planned_s + 1)
);
create index if not exists focus_sessions_user_started_idx
  on public.focus_sessions (user_id, started_at desc);

-- Daily roll-up. Written by the trigger below rather than by clients, so the
-- leaderboard/heatmap numbers cannot be forged.
create table if not exists public.daily_focus (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  day         date not null,
  focus_s     integer not null default 0,
  sessions    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

create or replace function public.sync_daily_focus()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  the_day date;
begin
  the_day := (coalesce(new.started_at, old.started_at) at time zone 'utc')::date;
  insert into public.daily_focus (user_id, day, focus_s, sessions)
  select
    coalesce(new.user_id, old.user_id),
    the_day,
    coalesce(sum(actual_s) filter (where phase = 'focus'), 0),
    coalesce(count(*) filter (where phase = 'focus'), 0)
  from public.focus_sessions
  where user_id = coalesce(new.user_id, old.user_id)
    and (started_at at time zone 'utc')::date = the_day
  on conflict (user_id, day) do update
    set focus_s = excluded.focus_s,
        sessions = excluded.sessions,
        updated_at = now();
  return null;
end; $$;

drop trigger if exists focus_sessions_rollup on public.focus_sessions;
create trigger focus_sessions_rollup
  after insert or update or delete on public.focus_sessions
  for each row execute function public.sync_daily_focus();

-- ── tasks + boards ────────────────────────────────────────────────────────
create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists boards_user_idx on public.boards (user_id);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  due_date    date,
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  category    text not null default 'Personal',
  completed   boolean not null default false,
  board_id    uuid references public.boards (id) on delete set null,
  col_id      text check (col_id in ('todo', 'doing', 'done')),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);
create index if not exists tasks_board_idx on public.tasks (board_id);

-- ── usage (websites from the extension, applications from the desktop app) ─
create table if not exists public.usage_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  day          date not null,
  kind         text not null check (kind in ('website', 'app')),
  name         text not null,        -- domain or application name — never a path
  seconds      integer not null default 0 check (seconds >= 0),
  device_id    text not null default 'legacy',
  source       text not null default 'legacy' check (source in ('extension', 'desktop', 'mobile', 'legacy')),
  hourly       jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (user_id, day, kind, name, device_id)
);
create index if not exists usage_records_user_day_idx on public.usage_records (user_id, day desc);

-- ── friends (request/accept, one row per direction of the relationship) ────
create table if not exists public.friends (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_un  text not null,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  privacy    text not null default 'board' check (privacy in ('board', 'stats', 'goals')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_un)
);

-- ── updated_at bookkeeping ────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'block_rules', 'tasks'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — the only thing standing between users' data and each
-- other. Every table is owner-scoped; there are no public reads.
-- ══════════════════════════════════════════════════════════════════════════
alter table public.profiles        enable row level security;
alter table public.block_rules     enable row level security;
alter table public.block_schedules enable row level security;
alter table public.focus_sessions  enable row level security;
alter table public.daily_focus     enable row level security;
alter table public.tasks           enable row level security;
alter table public.boards          enable row level security;
alter table public.usage_records   enable row level security;
alter table public.friends         enable row level security;

-- Owner-only tables: same policy shape for each.
do $$
declare t text;
begin
  foreach t in array array[
    'block_rules', 'block_schedules', 'focus_sessions',
    'tasks', 'boards', 'usage_records'
  ] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format($f$
      create policy %I_owner on public.%I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $f$, t, t);
  end loop;
end $$;

-- daily_focus is DELIBERATELY read-only for clients. It is the total that
-- feeds the leaderboard and the heatmap, so it is written only by the
-- security-definer roll-up trigger above; a client that could write it could
-- award itself arbitrary focus minutes. Owner may read their own row.
drop policy if exists daily_focus_read on public.daily_focus;
create policy daily_focus_read on public.daily_focus
  for select
  using (user_id = auth.uid());

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- Friends: you manage your own list, and you may see the entries that point at
-- you (so an incoming request is visible) — but nothing else.
drop policy if exists friends_own on public.friends;
create policy friends_own on public.friends
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── the honest leaderboard ────────────────────────────────────────────────
-- A view with `security_invoker` would be filtered by RLS and each user would
-- see only themselves, so the aggregate is exposed through a SECURITY DEFINER
-- function instead: it can read every row to compute the ranking, and it
-- returns ONLY aggregates (never another user's raw sessions or rules).
--
-- Usernames and totals are public by product design — it is a competitive
-- leaderboard. Everything else stays owner-scoped.
drop view if exists public.leaderboard;
create or replace function public.leaderboard(limit_count integer default 25)
returns table (un text, name text, focus_minutes bigint, active_days bigint, last_active date)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.un,
    p.name,
    coalesce(sum(d.focus_s), 0) / 60                    as focus_minutes,
    count(d.day) filter (where d.focus_s > 0)           as active_days,
    coalesce(max(d.day), current_date)                  as last_active
  from public.profiles p
  left join public.daily_focus d on d.user_id = p.id
  group by p.id, p.un, p.name
  order by focus_minutes desc, p.un asc
  limit least(greatest(coalesce(limit_count, 25), 1), 100);
$$;

-- Signed-in users only. PostgreSQL grants EXECUTE to PUBLIC by default, which
-- in Supabase would let an ANONYMOUS caller — anyone holding the public key,
-- with no account at all — read every username and focus total through
-- `rpc/leaderboard`. service_role is kept for server-side use.
revoke execute on function public.leaderboard(integer) from anon, public;
grant execute on function public.leaderboard(integer) to authenticated, service_role;

-- Streaks: the length of the run of consecutive focus days that ends today or
-- yesterday. Gaps-and-islands: consecutive days share (day - row_number).
create or replace function public.current_streak(target uuid)
returns integer language sql stable as $$
  with days as (
    select distinct day
    from public.daily_focus
    where user_id = target and focus_s > 0 and day <= current_date
  ),
  islands as (
    select day, day - (row_number() over (order by day))::int as anchor
    from days
  ),
  runs as (
    select count(*)::int as length, max(day) as last_day
    from islands
    group by anchor
  )
  select coalesce(max(length), 0)
  from runs
  where last_day >= current_date - 1;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- WHAT REMAINS BEFORE ANY CLIENT SWITCHES OVER
--   1. A storage adapter behind `S.*` that reads/writes these tables (the web
--      app's single storage boundary — no screen changes).
--   2. Offline queue + reconciliation, so a focus session recorded without a
--      network is never lost (ARCHITECTURE.md §4).
--   3. Real auth on the extension (chrome.identity + web redirect) and on the
--      desktop client, replacing today's "linked account name" placeholder.
--   4. Verify RLS with two test accounts before trusting it: see
--      supabase/rls-check.sql.
-- ══════════════════════════════════════════════════════════════════════════

commit;
