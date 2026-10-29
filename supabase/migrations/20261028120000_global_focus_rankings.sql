-- Only the established public focus aggregates are exposed. No email, usage,
-- task names or session records leave their owner-scoped tables.
create or replace function public.focus_rankings(limit_count integer default 25)
returns table(un text, name text, focus_minutes bigint, active_days bigint, last_active date, rank bigint)
language sql stable security definer set search_path = '' as $$
  with totals as (
    select p.id, p.un, p.name, coalesce(sum(d.focus_s),0)::bigint as seconds,
      count(d.day) filter(where d.focus_s > 0) as active_days,
      max(d.day) as last_active
    from public.profiles p left join public.daily_focus d on d.user_id=p.id
    group by p.id,p.un,p.name
  ), ranked as (
    select *, row_number() over(order by seconds desc,un asc) as position from totals
  )
  select r.un,r.name,r.seconds/60,r.active_days,r.last_active,r.position
  from ranked r
  where auth.uid() is not null and
    (r.position <= least(greatest(coalesce(limit_count,25),1),100) or r.id=auth.uid())
  order by r.position;
$$;
revoke all on function public.focus_rankings(integer) from public,anon;
grant execute on function public.focus_rankings(integer) to authenticated;
