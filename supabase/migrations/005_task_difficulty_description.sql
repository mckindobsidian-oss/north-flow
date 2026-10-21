-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — migration 005: persist a task's difficulty and description.
--
-- STATUS: WRITTEN, NOT APPLIED. Per the working agreement nothing touches the
-- live database without an explicit go-ahead. The client works WITHOUT this
-- migration: pushTasks detects the absent columns (PGRST204 / 42703) and
-- retries the push without them, so every other task field still syncs and
-- these two simply stay on the device — exactly how they behaved before this
-- file existed. See `isMissingColumn` in react-app/src/lib/sync.js.
--
-- WHY IT EXISTS
--   The Tasks form asks for three separate scales (priority, difficulty,
--   category) plus a description, and the app has carried all four in its own
--   record shape since the UI pass. Three of them had columns; difficulty and
--   description did not, so they were silently local-only: the values appeared
--   in the UI but never reached the server, and a second device showed the task
--   without them. There is no schema change here that alters the meaning of an
--   existing row.
--
-- WHAT IT ADDS — and why these exact shapes
--   difficulty   text NOT NULL DEFAULT 'medium', checked against the same three
--                values the client offers (easy / medium / hard).
--                NOT NULL with a DEFAULT is deliberate: every existing row is
--                backfilled to 'medium', which is precisely what the client
--                already inferred for a record with no difficulty
--                (`diffOf()` reads a missing value as "medium"). So an old row
--                and a new row mean the same thing, and no read path has to
--                handle a NULL scale.
--   description  text, NULLABLE with no default. A task without a description
--                is the common case, and the UI already renders the field only
--                when one is present. NULL is the honest representation of
--                "none" — an empty string would be a value the user never
--                typed and would show the field as present-but-blank.
--                Deliberately unbounded: the client caps what it sends, and a
--                length CHECK here could only ever reject a write from a
--                different client and fail its whole task push.
--
-- WHY 'difficulty' IS NOT 'priority'
--   They are two independent scales. Priority is how much the task matters;
--   difficulty is how hard it is. Collapsing them (or reusing the priority
--   check constraint) would make "important but easy" unrepresentable, which is
--   the exact ambiguity the labelled form was built to remove.
--
-- SECURITY: NO POLICY CHANGES
--   public.tasks already has owner-only RLS, and RLS applies to the whole row —
--   these are two more columns on a row the owner already fully controls, so
--   they need no policy of their own and cannot widen who can read the row.
--
-- ORDERING: independent of 001/002/003/004.
--   This file only alters public.tasks, which the baseline schema creates. It
--   can be applied at any point after supabase/schema.sql. It is written to be
--   safely re-runnable (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS), so applying
--   it twice is a no-op rather than an error.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── difficulty: a named three-value scale, backfilled to 'medium' ─────────
alter table public.tasks
  add column if not exists difficulty text not null default 'medium';

-- Drop-then-add (instead of ADD CONSTRAINT) so re-running this file is safe;
-- an unnamed constraint would also be re-created under a generated name and
-- accumulate duplicates on every run.
alter table public.tasks
  drop constraint if exists tasks_difficulty_check;
alter table public.tasks
  add constraint tasks_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard'));

-- ── description: optional free text ───────────────────────────────────────
alter table public.tasks
  add column if not exists description text;

-- ── confirm ───────────────────────────────────────────────────────────────
-- Expect two rows: difficulty (NO is_nullable = f, default 'medium'::text) and
-- description (is_nullable = YES, no default).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tasks'
  and column_name in ('difficulty', 'description')
order by column_name;

commit;
