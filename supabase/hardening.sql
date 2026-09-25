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

-- ── 2. trigger functions and slug_username: verified safe, NOT revoked ────
-- Every function in the public schema was probed with the anon key. Results:
--
--   leaderboard(integer)    401 42501 permission denied   -> correctly revoked
--   current_streak(uuid)    200 "0"                      -> FIXED BY SECTION 1
--   slug_username(text)     200 "abc.de"                 -> harmless, see below
--   handle_new_user()       404 PGRST202                  -> not reachable (a)
--   sync_daily_focus()      404 PGRST202                  -> not reachable (a)
--   touch_updated_at()      404 PGRST202                  -> not reachable (a)
--
-- (a) The three trigger functions are not merely unexploitable by nature —
--     PostgREST cannot resolve them as callable endpoints at all. They take no
--     arguments, so /rpc/<name> matches no signature and returns 404. Nothing
--     to revoke.
--
-- slug_username(text) IS reachable by anon and returns its input slugged. It is
-- an IMMUTABLE pure string function that reads no table, so it discloses
-- nothing. It is deliberately LEFT ALONE for a specific reason: the same
-- function is used by the CHECK constraint `profiles_un_lowercase` on
-- profiles, i.e. it sits on the account-creation path. Revoking EXECUTE to
-- reduce an already-zero attack surface is not worth any risk to the single
-- most important write in the system.
--
-- Recorded so the next person does not have to re-derive it.

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
