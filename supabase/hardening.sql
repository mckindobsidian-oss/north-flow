-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — security hardening (run once, in the Supabase SQL editor).
--
-- Companion to supabase/schema.sql. That file creates the tables and their
-- policies; this one closes the two grant-level gaps that were found by probing
-- the live project with the public anon key. Idempotent — re-running is safe.
--
-- WHY A SEPARATE FILE
-- schema.sql is already applied to the live database. Appending to it would
-- mean re-running the whole schema to pick up two statements, so the fix lives
-- on its own where it can be reviewed and applied independently.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. current_streak() is not for anonymous callers ─────────────────────
-- Found by probing: POST /rest/v1/rpc/current_streak as anon returned HTTP 200.
-- It leaks nothing, because the function is NOT `security definer`, so RLS
-- confines it to the caller's own rows — an anonymous caller gets 0. It is
-- still the wrong default: PostgreSQL grants EXECUTE on new functions to
-- PUBLIC, so every function in the schema is anon-callable until revoked.
--
-- Same treatment as leaderboard(): revoked from the anonymous role, kept for
-- the roles that legitimately need it.
revoke execute on function public.current_streak(uuid) from anon, public;
grant  execute on function public.current_streak(uuid) to authenticated, service_role;

-- ── 2. trigger functions: deliberately NOT revoked ───────────────────────
-- handle_new_user(), sync_daily_focus() and touch_updated_at() are SECURITY
-- DEFINER trigger functions that also inherit PUBLIC EXECUTE. They are not
-- exploitable through the API — PostgreSQL refuses a direct call with "trigger
-- functions can only be called as triggers" — so no grant is changed here.
-- Revoking EXECUTE on handle_new_user() was considered and rejected as
-- unnecessary risk on the single most important path (account creation).
-- slug_username(text) is immutable and reads nothing, so it stays reachable.
--
-- This is a deliberate "leave it alone" decision, recorded so the next person
-- does not have to re-derive it.

-- ── 3. confirm the result ────────────────────────────────────────────────
-- Both columns must read `false`. If either is true, the revoke above did not
-- take effect (most likely the function signature differs in your database).
select
  has_function_privilege('anon', 'public.current_streak(uuid)',    'execute') as anon_can_call_streak,
  has_function_privilege('anon', 'public.leaderboard(integer)',    'execute') as anon_can_call_leaderboard;

-- Full grant map for the public schema, for the record.
select
  p.proname                                as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  coalesce(array_to_string(p.proacl, ' | '), '(default: PUBLIC EXECUTE)') as grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

commit;
