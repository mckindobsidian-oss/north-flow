-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — row-level security check.
--
-- RLS that has never been attacked is a hope, not a control. Run this after
-- applying supabase/schema.sql, with TWO real accounts you created through the
-- app (sign up twice), and confirm every answer matches the "expected" comment.
--
-- The Supabase SQL editor connects as a privileged role that BYPASSES RLS, so
-- each block below impersonates an authenticated user the way PostgREST does:
-- switching to the `authenticated` role and setting the JWT claims that
-- `auth.uid()` reads. `rollback` at the end of each block leaves no trace.
--
-- Replace the two UUIDs (Authentication → Users in the dashboard) and the
-- usernames, then run each transaction one at a time.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 0. find the two account ids to paste into every block below ──────────
-- Run this on its own first. Copy `id` from the first two rows and replace
-- 00000000-0000-0000-0000-000000000001 and ...-0002 in the blocks that
-- follow. Two accounts must exist for any of this to mean anything: sign up
-- twice through the app (and confirm both emails) before running it.
select id, email, coalesce(raw_user_meta_data ->> 'name', '') as name, created_at
from auth.users
order by created_at
limit 2;

-- ── 1. profiles: you cannot read anyone else's row ────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
select count(*) as visible_profiles from public.profiles;   -- expected: 1 (yourself)
rollback;

-- ── 2. tasks / rules / schedules: owner-scoped both ways ──────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- expected: only your own rows, never the other account's
select count(*) as visible_tasks      from public.tasks;
select count(*) as visible_rules      from public.block_rules;
select count(*) as visible_schedules  from public.block_schedules;
select count(*) as visible_usage      from public.usage_records;
rollback;

-- ── 3. you cannot write a row that belongs to someone else ────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- expected: ERROR — new row violates row-level security policy
insert into public.tasks (user_id, title)
values ('00000000-0000-0000-0000-000000000002', 'forged task');
rollback;

-- ── 4. the leaderboard total is NOT client-writable ───────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- expected: ERROR — daily_focus has a SELECT-only policy (a client able to
-- write this could award itself arbitrary focus minutes and top the board)
insert into public.daily_focus (user_id, day, focus_s, sessions)
values ('00000000-0000-0000-0000-000000000001', current_date, 999999, 99);
rollback;

-- ── 5. the aggregate IS readable, and leaks nothing but aggregates ────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- expected: a ranked list containing other users' username + totals only
select * from public.leaderboard(10);
-- expected: still your own rows only — the function cannot be used to read
-- another user's raw sessions
select count(*) as visible_sessions from public.focus_sessions;
rollback;

-- ── 6. sessions cannot be rewritten into bigger numbers ───────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- expected: ERROR — actual_s <= planned_s + 1 (check constraint)
update public.focus_sessions set actual_s = planned_s + 600 where user_id = auth.uid();
rollback;
