/**
 * NORTH — extension GoTrue helpers (pure halves).
 *
 * The MV3 worker cannot import the supabase SDK (no bundler), so lib/goTrue.js
 * speaks the documented REST protocol directly. This pins the pure piece the
 * session lifecycle depends on: JWT expiry parsing used to decide when a
 * refresh is needed. A malformed token must yield null (→ refresh attempt),
 * never a crash and never a trusted default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createGoTrue, decodeJwtPayload } from "../apps/extension/lib/goTrue.js";
import { setConfig } from "../apps/extension/lib/north-auth.js";

test("the website can safely re-pair the extension with the same public account config", async () => {
  const previousChrome = globalThis.chrome;
  const values = {};
  globalThis.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in values).map((key) => [key, values[key]])),
    set: async (items) => Object.assign(values, items),
    remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  } } };
  try {
    assert.equal(await setConfig("https://project.supabase.co", "public-anon-key", "http://localhost:5173"), true);
    assert.equal(await setConfig("https://project.supabase.co", "public-anon-key", "http://localhost:5173"), true);
    assert.equal(values.northSupabaseUrl, "https://project.supabase.co");
    assert.equal(values.northSupabaseAnonKey, "public-anon-key");
  } finally {
    globalThis.chrome = previousChrome;
  }
});

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

test("a well-formed JWT payload decodes, including exp", () => {
  const jwt = `aaa.${b64url({ sub: "u1", exp: 1893456000 })}.bbb`;
  const p = decodeJwtPayload(jwt);
  assert.equal(p.sub, "u1");
  assert.equal(p.exp, 1893456000);
});

test("malformed tokens decode to null instead of throwing", () => {
  assert.equal(decodeJwtPayload(""), null);
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(decodeJwtPayload("a.!!!.b"), null);
  assert.equal(decodeJwtPayload(null), null);
  assert.equal(decodeJwtPayload(undefined), null);
});

test("extension adopts only a server-verified website session", async () => {
  const originalFetch = globalThis.fetch;
  const saved = new Map();
  const storage = {
    get: async (key) => ({ [key]: saved.get(key) }),
    set: async (values) => { for (const [key, value] of Object.entries(values)) saved.set(key, value); },
    remove: async (key) => saved.delete(key),
  };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://project.supabase.co/auth/v1/user");
      assert.equal(options.headers.Authorization, "Bearer website-access");
      return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), { status: 200 });
    };
    const auth = createGoTrue({ url: "https://project.supabase.co", anonKey: "public", storage, sessionKey: "session" });
    const user = await auth.adoptSession({ access_token: "website-access", refresh_token: "website-refresh" });
    assert.equal(user.id, "user-1");
    assert.equal(saved.get("session").refresh_token, "website-refresh");
    await assert.rejects(auth.adoptSession({ access_token: "", refresh_token: "" }), /complete sign-in session/);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "invalid JWT" }), { status: 401 });
    const otherSaved = new Map();
    const otherAuth = createGoTrue({
      url: "https://project.supabase.co", anonKey: "public", sessionKey: "session",
      storage: { get: async (key) => ({ [key]: otherSaved.get(key) }), set: async (items) => { for (const [key, value] of Object.entries(items)) otherSaved.set(key, value); }, remove: async (key) => otherSaved.delete(key) },
    });
    await assert.rejects(otherAuth.adoptSession({ access_token: "invalid", refresh_token: "refresh" }));
    assert.equal(otherSaved.has("session"), false, "unverified sessions are never persisted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extension repairs a stale handed-off access token with one verified refresh", async () => {
  const originalFetch = globalThis.fetch;
  const saved = new Map();
  const calls = [];
  const storage = {
    get: async (key) => ({ [key]: saved.get(key) }),
    set: async (values) => { for (const [key, value] of Object.entries(values)) saved.set(key, value); },
    remove: async (key) => saved.delete(key),
  };
  try {
    globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      if (String(url).endsWith("/user") && options.headers.Authorization === "Bearer stale-access") {
        return new Response(JSON.stringify({ message: "Session from session_id claim in JWT does not exist" }), { status: 401 });
      }
      if (String(url).includes("grant_type=refresh_token")) {
        return new Response(JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "user-1", email: "person@example.com" }), { status: 200 });
    };
    const auth = createGoTrue({ url: "https://project.supabase.co", anonKey: "public", storage, sessionKey: "session" });
    const user = await auth.adoptSession({ access_token: "stale-access", refresh_token: "old-refresh" });
    assert.equal(user.id, "user-1");
    assert.equal(saved.get("session").access_token, "fresh-access");
    assert.equal(calls.filter((url) => url.includes("grant_type=refresh_token")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

