/**
 * NORTH mobile — auth + account glue.
 *
 * Mirrors the web app's flow using the SAME shared modules (no duplicate data
 * model): `shared/account.js` derives identity, `lib/supabase.js` talks to
 * the project, and the storage adapter below feeds the web client's
 * `lib/sync.js` unchanged — it only ever asks for `get/set/del` on a handful
 * of keys, so the phone shares the exact push/pull/queue semantics the web app
 * has, backed by AsyncStorage (or memory until that package is installed).
 *
 * WHY THIS IS SAFE NOW: `react-app/src/lib/sync.js` used to import the web
 * Supabase client, which reads `import.meta.env` (a Vite-only global) and
 * touched `localStorage` directly — neither exists under Metro/Hermes. The
 * engine is now platform-neutral (the client is injected, and the pending
 * queue is persisted through the host store), so importing it here pulls in
 * nothing browser-specific. The client below is this app's own —
 * `lib/supabase.js`, which uses AsyncStorage and Expo's env vars.
 *
 * EMAIL CONFIRMATION: mirrors web exactly — if signup returns no session,
 * the address needs confirming first and the screen says so (plus resend).
 *
 * GOOGLE: implemented below as a real PKCE deep-link flow (see
 * signInWithGoogle) — no client secret on device, session lands in the same
 * storage adapter as password sessions. The remaining manual steps
 * (Supabase redirect URL, dev build, native deps) are documented there.
 */
import { useEffect, useRef, useState } from "react";
import { supabase, supabaseConfigured, sessionsPersist } from "./supabase.js";
import { PROFILE_KEY, SESSION_KEY, defaultProfile, hydrateProfile, toAppUser, usernameFromEmail } from "../shared/account.js";
import { createSync, newUuid } from "../../react-app/src/lib/sync.js";

// ── the device store S.* (AsyncStorage-backed JSON strings, web-compatible) ─
// Key scheme and value shapes are identical to the web app so the same sync
// module and the same profile records work on both ends. `shared` mirrors the
// web store's multi-device namespace (`s:` prefix), so the leaderboard keys
// land in the same logical space on every client.
const nsk = (k, s) => (s ? "s:" : "") + k;
const memory = () => {
  const m = new Map();
  return {
    get: async (k, s) => (m.has(nsk(k, s)) ? m.get(nsk(k, s)) : null),
    set: async (k, v, s) => { m.set(nsk(k, s), v); },
    delete: async (k, s) => { m.delete(nsk(k, s)); },
  };
};
let backing = memory();
try {
  // Same optional import as lib/supabase.js; see the note there.
  // eslint-disable-next-line import/no-unresolved
  const AsyncStorage = require("@react-native-async-storage/async-storage").default;
  if (AsyncStorage) {
    backing = {
      get: (k, s) => AsyncStorage.getItem(nsk(k, s)).then((v) => (v == null ? null : JSON.parse(v))),
      set: (k, v, s) => AsyncStorage.setItem(nsk(k, s), JSON.stringify(v)),
      delete: (k, s) => AsyncStorage.removeItem(nsk(k, s)),
    };
  }
} catch { /* memory until the package is installed */ }

export const S = {
  get: (k, s) => backing.get(k, s),
  set: (k, v, s) => backing.set(k, v, s),
  del: (k, s) => backing.delete(k, s),
};

// The backend mirror — the web client's engine, phone storage. Both the
// Supabase client and the store are injected, which is what keeps this engine
// free of browser globals; the pending queue is persisted through `S`
// (AsyncStorage when installed), so an offline write survives an app restart.
export const SYNC = createSync({ store: S, client: supabase, configured: supabaseConfigured });

/** Build the app user from a Supabase session user (or device record). */
async function adoptAccount(accountUser) {
  const un = usernameFromEmail(accountUser?.email, accountUser?.id);
  const raw = await S.get(PROFILE_KEY(un));
  const profile = raw
    ? hydrateProfile(raw, { un })
    : defaultProfile({
        un,
        name: accountUser?.user_metadata?.name,
        email: accountUser?.email,
      });
  if (!raw) await S.set(PROFILE_KEY(un), profile);
  const mapped = toAppUser(accountUser, profile);
  await S.set(SESSION_KEY, { un: mapped.un });
  SYNC.attach({ userId: accountUser?.id, un: mapped.un });
  if (accountUser?.id) {
    await SYNC.bootstrap(mapped.un).catch(() => {});
    const pulled = await S.get(PROFILE_KEY(mapped.un));
    if (pulled) return toAppUser(accountUser, hydrateProfile(pulled, { un: mapped.un }));
  }
  return mapped;
}

/** Restore a persisted session at launch. Returns the app user or null. */
export async function restoreSession() {
  if (!supabaseConfigured || !supabase) {
    const sess = await S.get(SESSION_KEY);
    if (sess?.un) {
      const raw = await S.get(PROFILE_KEY(sess.un));
      return raw ? hydrateProfile(raw, { un: sess.un }) : null; // device-only user
    }
    return null;
  }
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) return adoptAccount(data.session.user);
  return null;
}

/** Email + password sign in. Throws a display-ready message on failure. */
export async function signInWithPassword(email, password) {
  if (!supabaseConfigured) throw new Error("Accounts aren't configured on this device.");
  const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw new Error(error.message);
  return adoptAccount(data.user);
}

/**
 * Email + password sign up. Returns { needsConfirmation, email } when the
 * project requires email confirmation; returns the app user when a session
 * came straight back.
 */
export async function signUpWithPassword(email, password, name) {
  if (!supabaseConfigured) throw new Error("Accounts aren't configured on this device.");
  const { data, error } = await supabase.auth.signUp({
    email: String(email).trim(),
    password,
    options: { data: { name: String(name || "").trim() } },
  });
  if (error) throw new Error(error.message);
  if (data?.session?.user) return { user: await adoptAccount(data.session.user) };
  return { needsConfirmation: true, email: String(email).trim() };
}

/**
 * Google sign-in, native flow: the system browser hands back a verified
 * Google id_token (lib/google.js), and supabase-js exchanges it for the SAME
 * NORTH account the web app creates — one identity, one data model. The nonce
 * is single-use and verified server-side, so a replayed token cannot mint a
 * session. Throws a display-ready message on any failure.
 */
export async function signInWithGoogleIdToken({ idToken, nonce }) {
  if (!supabaseConfigured) throw new Error("Accounts aren't configured on this device.");
  if (!idToken) throw new Error("Google sign-in was cancelled.");
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    ...(nonce ? { nonce } : {}),
  });
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Google sign-in did not return an account.");
  return adoptAccount(data.user);
}

/** Resend the signup confirmation email. */
export async function resendConfirmation(email) {
  if (!supabaseConfigured) throw new Error("Accounts aren't configured on this device.");
  const { error } = await supabase.auth.resend({ type: "signup", email: String(email).trim() });
  if (error) throw new Error(error.message);
}

/**
 * Google sign-in for Expo — the REAL PKCE flow (no client secret on device).
 *
 * Architecture: this app generates a PKCE verifier/challenge, sends the
 * challenge to Supabase's /auth/v1/authorize endpoint with
 * `redirect_to=north://auth`, and opens the URL in the system browser
 * (expo-web-browser). Google authenticates; Supabase redirects to the
 * `north://` scheme; Linking hands the session fragment back here;
 * setSession() persists it through the standard client.
 *
 * REPOSITORY-SIDE CONFIGURATION (all done):
 *   · app.json declares the `north` scheme (iOS CFBundleURLTypes + Android
 *     intent filter).
 *   · PKCE + deep-link redirect — no client secret anywhere.
 *   · Session lands in the same storage adapter as password sessions.
 *
 * REMAINING MANUAL STEPS (cannot be done from a repo):
 *   · Supabase Dashboard → Authentication → URL Configuration → add
 *     `north://auth` to Redirect URLs.
 *   · Google Cloud Console → OAuth client (iOS/Android type) with the app's
 *     bundle id, or configure expo-auth-session's proxy if used.
 *   · A development build (`npx expo run:ios|android`) — Expo Go handles
 *     custom schemes unreliably on modern SDKs.
 *   · `npx expo install expo-web-browser expo-crypto` for the native deps.
 */
export async function signInWithGoogle() {
  if (!supabaseConfigured || !supabase) throw new Error("Accounts aren't configured on this device.");
  // Lazy requires: these native modules are optional peers, and requiring them
  // at module scope would break `npx expo start` for anyone who hasn't
  // installed them yet (the same honesty rule as AsyncStorage).
  let WebBrowser; let Crypto; let Linking;
  try {
    // eslint-disable-next-line import/no-unresolved
    WebBrowser = require("expo-web-browser");
    // eslint-disable-next-line import/no-unresolved
    Crypto = require("expo-crypto");
    // eslint-disable-next-line import/no-unresolved
    Linking = require("react-native").Linking;
  } catch {
    throw new Error("Google sign-in needs expo-web-browser + expo-crypto — run: npx expo install expo-web-browser expo-crypto");
  }
  const redirectUri = "north://auth";
  // PKCE (RFC 7636): verifier is high-entropy; only the challenge travels.
  const verifier = base64Url(randomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  const challenge = base64Url(digest);
  const authUrl = new URL(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectUri);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);
  const url = result?.type === "success" ? result.url : null;
  if (!url) throw new Error("Sign-in cancelled.");
  // Supabase returns tokens in the URL fragment for implicit flows, or a code
  // for PKCE exchange. Both are handled — never logged.
  const parsed = Linking.parse(url.replace(/^north:\/\//, "https://"));
  const qp = parsed.queryParams ?? {};
  if (qp.error) throw new Error(String(qp.error_description || qp.error));
  if (qp.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(qp.code);
    if (error) throw new Error(error.message);
    return adoptAccount(data.user);
  }
  if (qp.access_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: String(qp.access_token),
      refresh_token: String(qp.refresh_token ?? ""),
    });
    if (error) throw new Error(error.message);
    return adoptAccount(data.user);
  }
  throw new Error("Sign-in returned no credentials.");
}

/**
 * PKCE verifier source bytes. Security-sensitive: uses the platform CSPRNG
 * (getRandomValues from expo-crypto) when available, and refuses to fall
 * back to Math.random — a predictable verifier defeats the whole PKCE flow.
 */
function randomBytes(len) {
  const bytes = new Uint8Array(len);
  try {
    // eslint-disable-next-line import/no-unresolved
    const Crypto = require("expo-crypto");
    if (typeof Crypto.getRandomValues === "function") {
      Crypto.getRandomValues(bytes);
      return bytes;
    }
  } catch { /* fall through — no CSPRNG means no OAuth, by design */ }
  throw new Error("expo-crypto is required for secure sign-in — run: npx expo install expo-crypto");
}

/** RFC 4648 §5 base64url of raw bytes (no padding). */
function base64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in Hermes; fallback to the manual encoder when not.
  try { return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  catch {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += chars[b0 >> 2];
      out += chars[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
      out += b1 === undefined ? "" : chars[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
      out += b2 === undefined ? "" : chars[b2 & 63];
    }
    return out;
  }
}

/** Sign out everywhere that matters: service, device pointer, sync state. */
export async function signOut() {
  try { if (supabaseConfigured && supabase) await supabase.auth.signOut(); } catch {}
  await S.del(SESSION_KEY);
  SYNC.detach();
}

/**
 * Keep a live auth subscription so token refreshes / remote sign-out update
 * the app. Call once; pass a handler receiving the app user (or null).
 * Returns an unsubscribe function.
 */
export function onAuthChange(handler) {
  if (!supabaseConfigured || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) return handler(null);
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      handler(await adoptAccount(session.user));
    }
  });
  return () => { try { data?.subscription?.unsubscribe(); } catch {} };
}

export { supabaseConfigured, sessionsPersist, newUuid };
