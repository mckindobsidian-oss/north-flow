-- ══════════════════════════════════════════════════════════════════════════
-- NORTH — migration 002: per-user integration connections (Google Calendar,
-- Spotify).
--
-- STATUS: WRITTEN, NOT APPLIED. Apply in the Supabase SQL editor; nothing in
-- the client breaks before it exists (the integrations features report
-- "not connected" and the sync layer skips the table, exactly like the
-- task_id fallback pattern).
--
-- WHAT IT STORES — the minimum, and nothing more:
--   provider        which external service (google_calendar, spotify, …)
--   account_email   the external account the grant belongs to (display only)
--   scope           the scopes actually granted (transparency/audit)
--   connected_at    when the grant was made
--
-- WHAT IT DELIBERATELY DOES NOT STORE:
--   access/refresh tokens. They live in Supabase Vault, written only by the
--   google-calendar Edge Function (service_role, server-side). A client that
--   could read this table still could not read another user's calendar: the
--   tokens are never here, and the function only ever acts on the caller's
--   own connection.
--
-- RLS: identical owner-only shape to every other North table.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.integrations (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  provider      text not null,
  account_email text,
  scope         text,
  connected_at  timestamptz not null default now(),
  primary key (user_id, provider)
);

-- The two functions that write this table (google-calendar, spotify Edge
-- Functions) upsert by (user_id, provider); add a check so a typo'd provider
-- value cannot silently create a parallel identity namespace.
alter table public.integrations
  drop constraint if exists integrations_provider_check;
alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google_calendar', 'spotify'));

alter table public.integrations enable row level security;

drop policy if exists integrations_owner on public.integrations;
create policy integrations_owner on public.integrations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── confirm ───────────────────────────────────────────────────────────────
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'integrations';

commit;
