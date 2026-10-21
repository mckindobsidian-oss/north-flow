-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — migration 001: link focus sessions to tasks (Step 2A).
--
-- STATUS: WRITTEN, NOT APPLIED. Per the working agreement, nothing touches
-- the live database without an explicit go-ahead. The web client works
-- without this column: pushSessions detects its absence (42703) and pushes
-- sessions unlinked, exactly as they are today.
--
-- WHAT IT DOES
--   Adds focus_sessions.task_id — a nullable, owner-consistent reference to
--   the task a session worked on. Null means "no task chosen", which is the
--   default for every existing row and every session started without a task,
--   so nothing existing changes shape or meaning.
--
-- WHY NULLABLE WITH ON DELETE SET NULL
--   A task can be deleted long after sessions recorded time against it. The
--   sessions are permanent records (the heatmap and streaks derive from
--   them); the association is metadata and must never take a session with it.
--
-- SECURITY: NO POLICY CHANGES
--   focus_sessions already has one owner-only FOR ALL policy (`user_id =
--   auth.uid()`). RLS applies to the whole row, so task_id — a column on a
--   row the owner already fully controls — needs no policy of its own. The
--   FK adds one invariant RLS cannot express: the referenced task must
--   belong to the same user. Note the FK is validated (not NOT VALID) and
--   the constraint check runs as the table owner, so it cannot be used to
--   probe other users' task ids.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- Idempotent: skip when the column already exists (re-running is safe).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'focus_sessions'
      and column_name  = 'task_id'
  ) then
    alter table public.focus_sessions
      add column task_id uuid references public.tasks (id) on delete set null;
  end if;
end $$;

-- ── confirm the result ────────────────────────────────────────────────────
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'focus_sessions'
  and column_name  = 'task_id';

commit;
