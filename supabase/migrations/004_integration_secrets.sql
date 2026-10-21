-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — migration 004: a safe, service-role-only bridge to Supabase Vault.
--
-- WHY THIS EXISTS
-- The Edge Functions (google-calendar, spotify) originally wrote tokens with a
-- raw PostgREST call into `vault.secrets`:
--
--     POST https://<ref>.supabase.co/rest/v1/vault/secrets
--     { "name": "gcal/<uid>", "secret": "<plaintext json>" }
--
-- That does not work, for two independent reasons:
--
--   1. PostgREST only serves the schemas in its `db-schemas` list (default
--      `public`, `storage`, `graphql_public`). `vault` is NOT in it, so the
--      request never resolves — it comes back as a schema/404 error and the
--      function treats it as "could not store", or worse, ignores it.
--   2. Even if `vault` were exposed, `vault.secrets.secret` holds the
--      pgsodium CIPHERTEXT. Vault's own `vault.create_secret()` does the
--      encryption (and the nonce/key_id bookkeeping). Writing a plaintext
--      string into that column stores something `vault.decrypted_secrets`
--      cannot decrypt — so reads come back NULL and the connection silently
--      "never connects".
--
-- The fix keeps the same architecture (tokens in Vault, service_role only)
-- but goes through Vault's supported API. Three SECURITY DEFINER functions in
-- `public` wrap create_secret / decrypted_secrets / delete, and EXECUTE is
-- revoked from PUBLIC/anon/authenticated and granted only to service_role —
-- so a browser holding the anon key cannot call them at all. The Edge
-- Functions reach them over PostgREST RPC with their service key.
--
-- Tokens are still never stored in plaintext, never in a table, and never
-- readable by a client.
--
-- STATUS: apply in the Supabase SQL editor (same as migration 002).
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── write (insert or rotate) ─────────────────────────────────────────────
create or replace function public.north_secret_put(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if p_name is null or p_name = '' then
    raise exception 'north_secret_put: name is required';
  end if;
  if p_secret is null then
    raise exception 'north_secret_put: secret is required';
  end if;

  select id into existing_id from vault.secrets where name = p_name;
  if existing_id is null then
    perform vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(existing_id, p_secret);
  end if;
end;
$$;

-- ── read (decrypted) ─────────────────────────────────────────────────────
create or replace function public.north_secret_get(p_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
$$;

-- ── delete ───────────────────────────────────────────────────────────────
create or replace function public.north_secret_del(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = p_name;
$$;

-- ── lock the bridge down ─────────────────────────────────────────────────
-- Default EXECUTE goes to PUBLIC, which would let an anon-key client call
-- these directly (they are SECURITY DEFINER, so that would be a full Vault
-- read/write primitive). Revoke, then grant to service_role alone.
revoke all on function public.north_secret_put(text, text) from public;
revoke all on function public.north_secret_get(text) from public;
revoke all on function public.north_secret_del(text) from public;

grant execute on function public.north_secret_put(text, text) to service_role;
grant execute on function public.north_secret_get(text) to service_role;
grant execute on function public.north_secret_del(text) to service_role;

-- ── confirm ──────────────────────────────────────────────────────────────
select p.proname as function, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'north_secret_%'
order by p.proname;

commit;
