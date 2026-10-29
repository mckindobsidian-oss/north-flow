import test from "node:test";
import assert from "node:assert/strict";
import { applyDesktopBlocking, readDesktopUsage, startDesktopBridge, refreshDesktopSync } from "../react-app/src/lib/desktop.js";
import { desktopOAuthDestination, desktopGoogleSignIn } from "../react-app/src/lib/desktop-oauth.js";
import { defaultBlocking, newRule } from "../packages/shared-types/blocking.js";

test('manual desktop refresh bypasses the timer and reports failed account synchronization', async () => {
  const previousTauri = globalThis.__TAURI__, previousWindow = globalThis.window;
  let pushes = 0, fail = false;
  globalThis.window = new EventTarget();
  globalThis.__TAURI__ = { core: { invoke: async () => [] } };
  const stop = startDesktopBridge({
    user: { id: 'owner', un: 'alice' },
    client: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } },
    store: { get: async () => ({ blocking: defaultBlocking() }) },
    sync: { flush: async () => { pushes++; return { ok: !fail }; }, pull: async () => true },
  });
  try {
    await refreshDesktopSync();
    const first = pushes;
    await refreshDesktopSync();
    assert.equal(pushes, first + 1, 'manual refresh must not wait for the 30-second timer');
    fail = true;
    await assert.rejects(refreshDesktopSync(), /saved locally/);
  } finally {
    stop();
    await new Promise(resolve => setImmediate(resolve));
    globalThis.__TAURI__ = previousTauri; globalThis.window = previousWindow;
  }
});

test("desktop Google sign-in returns directly to its native callback and exchanges the code", async () => {
  const previous = globalThis.__TAURI__;
  let callback, nonce, redirect, exchanged, removed = false;
  globalThis.__TAURI__ = {
    event: { listen: async (_, listener) => { callback = listener; return () => { removed = true; }; } },
    core: { invoke: async (command, args) => {
      if (command === "begin_google_auth") {
        nonce = args.nonce;
        return `http://127.0.0.1:49001/north-auth/${nonce}`;
      }
      if (command === "open_google_auth") callback({ payload: { nonce, code: "one-use-test-code" } });
    } },
  };
  try {
    await desktopGoogleSignIn({ auth: {
      signInWithOAuth: async ({ options }) => {
        redirect = options.redirectTo;
        return { data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" } };
      },
      exchangeCodeForSession: async (code) => { exchanged = code; return {}; },
    } });
    assert.equal(redirect, `http://127.0.0.1:49001/north-auth/${nonce}`);
    assert.equal(exchanged, "one-use-test-code");
    assert.equal(removed, true);
  } finally { globalThis.__TAURI__ = previous; }
});

test("desktop bridge applies shared rules and clears enforcement on sign-out", async () => {
  const calls = [];
  const oldTauri = globalThis.__TAURI__;
  const oldWindow = globalThis.window;
  globalThis.window = new EventTarget();
  globalThis.__TAURI__ = { core: { invoke: async (command, args) => { calls.push({ command, args }); return []; } } };
  let stop;
  try {
    const blocking = { ...defaultBlocking(), rules: [newRule({ kind: "app", target: "notepad" })] };
    await applyDesktopBlocking(blocking);
    assert.equal(calls.at(-1).command, "apply_account_blocking");
    assert.equal(calls.at(-1).args.rules[0].target, "notepad");
    assert.deepEqual(await readDesktopUsage("user-a"), []);
    stop = startDesktopBridge({ user: null, client: null, store: {}, sync: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(calls.some(({ command, args }) => command === "set_usage_owner" && args.owner === null));
    assert.deepEqual(calls.at(-1).args.rules, []);
  } finally {
    stop?.();
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.__TAURI__ = oldTauri;
    globalThis.window = oldWindow;
  }
});

test("desktop OAuth accepts only the loopback relay shape", () => {
  const nonce = "12345678-1234-1234-1234-123456789abc";
  assert.equal(
    desktopOAuthDestination(`?desktopAuth=${encodeURIComponent(`http://127.0.0.1:41823/north-auth/${nonce}`)}`).toString(),
    `http://127.0.0.1:41823/north-auth/${nonce}`,
  );
  for (const value of [
    "https://evil.example/north-auth/12345678-1234-1234-1234-123456789abc",
    "http://localhost:41823/north-auth/12345678-1234-1234-1234-123456789abc",
    "http://127.0.0.1:41823/other",
    "http://user:pass@127.0.0.1:41823/north-auth/12345678-1234-1234-1234-123456789abc",
    "http://127.0.0.1:41823/north-auth/12345678-1234-1234-1234-123456789abc?leak=1",
  ]) assert.equal(desktopOAuthDestination(`?desktopAuth=${encodeURIComponent(value)}`), null);
});

test("desktop sync listens to native tray heartbeats and preserves failed offline edits", async () => {
  const previousTauri = globalThis.__TAURI__;
  const previousWindow = globalThis.window;
  let heartbeat, removed = false, pulls = 0;
  globalThis.window = new EventTarget();
  globalThis.__TAURI__ = {
    core: { invoke: async () => [] },
    event: { listen: async (_, callback) => { heartbeat = callback; return () => { removed = true; }; } },
  };
  let stop;
  try {
    stop = startDesktopBridge({
      user: { id: "account-a", un: "alice" },
      client: { auth: { getSession: async () => ({ data: { session: { user: { id: "account-a" } } } }) } },
      store: { get: async () => ({ blocking: defaultBlocking() }) },
      sync: { flush: async () => ({ ok: false }), pull: async () => { pulls += 1; } },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await heartbeat();
    assert.equal(pulls, 0);
    stop(); stop = null;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(removed, true);
  } finally {
    stop?.();
    globalThis.__TAURI__ = previousTauri;
    globalThis.window = previousWindow;
  }
});
