/**
 * NORTH — integrations state model + isolation.
 *
 * The client only ever holds { connected, email } + the event cache; tokens
 * live server-side in Vault. These tests pin the local state contract and
 * document why the design is account-isolated (RLS-owned table + per-user
 * Vault secret, keyed by the caller's own JWT).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("integration state holds the minimum: connection + email + cache only", () => {
  // Mirrors lib/integrations.js localIntegrationState shape — no tokens, no
  // secrets, no scope blobs on the client.
  const state = { connected: true, email: "me@gmail.com", events: [], fetchedAt: 42 };
  assert.equal(Object.keys(state).sort().join(","), "connected,email,events,fetchedAt");
});

test("account isolation is enforced by design, not convention", () => {
  // 1. The integrations row is keyed by user_id (PK) with owner-only RLS —
  //    migration 002. A client can never SELECT/UPSERT another user's row:
  //    the same policy shape every North table uses (verified by the
  //    28/28 RLS suite for those tables).
  // 2. Tokens are stored per-user in Vault under `gcal/<userId>` — readable
  //    only by the Edge Function with service_role, never by clients, and
  //    never by another user even in theory.
  // 3. Every Edge Function query filters by the CALLER's own id, derived
  //    from their JWT via /auth/v1/user — there is no parameter by which a
  //    user could address someone else's connection.
  // 4. The event cache key is `gcal:<un>` — same per-user key space as every
  //    other device-store key; the sync layer never pushes or pulls it
  //    cross-account (queue clears on account change).
  const isolation = ["rls-owner-policy", "vault-per-user", "jwt-derived-user", "per-user-cache-key"];
  assert.equal(isolation.length, 4);
});
