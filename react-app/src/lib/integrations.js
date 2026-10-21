/**
 * NORTH — integrations client (Google Calendar).
 *
 * Thin connector to the `google-calendar` Edge Function. The browser never
 * sees a client secret and never stores a token: the OAuth round trip happens
 * between the function and Google, and this side only ever learns
 * { connected, account_email } plus the event lists it asks for.
 *
 * INTEGRATION STATE
 * `gcal:<un>` in the device store holds the cached events (lib/calendar.js
 * shape) and `integrations:<un>` holds { connected, email, connectedAt }.
 * The connection row of record lives server-side (integrations table +
 * Vault tokens); these local keys are a cache for offline rendering.
 */
import { supabase, supabaseConfigured, normalizedUrl } from "./supabase.js";
import { normalizeEvents, saveCache, loadCache } from "./calendar.js";

const FUNCTION_NAME = "google-calendar";

function functionUrl(projectUrl) {
  return `${String(projectUrl).replace(/\/+$/, "")}/functions/v1/${FUNCTION_NAME}`;
}

async function authedFetch(path, body) {
  if (!supabaseConfigured || !supabase) throw new Error("not_configured");
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess?.session?.access_token;
  if (!jwt) throw new Error("signed_out");
  const res = await fetch(`${functionUrl(normalizedUrl)}?action=${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Supabase answers an undeployed function with {"code":"NOT_FOUND",…}.
    // Recognise it here so callers can say "not deployed yet" instead of
    // echoing an opaque id back to the user.
    const msg = data?.error || data?.message || `function ${res.status}`;
    const e = new Error(res.status === 404 || data?.code === "NOT_FOUND" ? "function_missing" : msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

/**
 * Read the marker the Edge Function appends when it bounces the browser back
 * from Google (`?gcal=connected` / `?gcal=error`) and STRIP it from the URL,
 * so a later refresh or a shared link cannot replay a message that already
 * happened. Returns null when this load did not come back from Google.
 */
export function consumeCalendarReturn() {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("gcal");
    if (!v) return null;
    url.searchParams.delete("gcal");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return { ok: v === "connected" };
  } catch {
    return null;
  }
}

/** Where the OAuth round trip should land back in the app. */
const appOrigin = () => window.location.origin + window.location.pathname;

/**
 * Start connecting: bounce to the function, which verifies this session and
 * bounces to Google. The JWT rides in the URL only on this first leg — the
 * function consumes it immediately to bind the signed OAuth state, and the
 * callback leg (Google's redirect) carries nothing but the opaque state.
 */
export async function connectGoogleCalendar() {
  if (!supabaseConfigured || !supabase) throw new Error("not_configured");
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess?.session?.access_token;
  if (!jwt) throw new Error("signed_out");
  const u = functionUrl(normalizedUrl);
  const start = new URL(`${u}?action=start`);
  start.searchParams.set("app", appOrigin());
  start.searchParams.set("jwt", jwt);
  window.location.assign(start.toString());
}

/**
 * Connection status: server is the source of truth; result is cached into
 * `integrations:<un>` for offline reads. Never throws for "not connected" —
 * that is a valid state, not an error.
 */
export async function googleCalendarStatus() {
  try {
    const s = await authedFetch("status");
    return { connected: Boolean(s.connected), email: s.account_email ?? null, connectedAt: s.connected_at ?? null };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg === "not_configured" || msg === "signed_out") return { connected: false, unavailable: true, reason: msg };
    if (msg === "function_missing") return { connected: false, unavailable: true, reason: "not_deployed" };
    return { connected: false, error: msg };
  }
}

/**
 * Refresh events (last 7 days → next 60). Returns the merged cache written
 * to the store, or { connected:false }. On any failure the previous cache is
 * preserved untouched (graceful offline behavior) and the error is returned.
 */
export async function syncGoogleCalendar(store, un) {
  const key = `gcal:${un}`;
  try {
    const res = await authedFetch("events", {
      timeMin: new Date(Date.now() - 7 * 864e5).toISOString(),
      timeMax: new Date(Date.now() + 60 * 864e5).toISOString(),
    });
    if (!res.connected) {
      await store.set(`integrations:${un}`, { connected: false, email: null, connectedAt: null });
      return { connected: false };
    }
    const fetched = normalizeEvents(res.events);
    const prev = loadCache(await store.get(key));
    const cache = saveCache(mergeLocal(prev, fetched), Date.now());
    await store.set(key, cache);
    await store.set(`integrations:${un}`, {
      connected: true,
      email: res.account_email ?? (await googleCalendarStatus()).email ?? null,
      connectedAt: Date.now(),
    });
    return { connected: true, events: cache.events, fetchedAt: cache.fetchedAt };
  } catch (e) {
    // Offline or function hiccup: keep the last successful state on disk.
    const prev = loadCache(await store.get(key));
    return { connected: Boolean((await store.get(`integrations:${un}`))?.connected), error: String(e?.message ?? e), events: prev.events };
  }
}

// mergeLocal is mergeCache re-exported under the name the sync loop uses.
import { mergeCache as mergeLocal } from "./calendar.js";

/** Disconnect: revoke server-side, clear the local cache + state. */
export async function disconnectGoogleCalendar(store, un) {
  await authedFetch("disconnect");
  await store.set(`integrations:${un}`, { connected: false, email: null, connectedAt: null });
  await store.set(`gcal:${un}`, { events: [], fetchedAt: 0 });
  return { connected: false };
}

/** Read the local state without network (offline-safe UI hydration). */
export async function localIntegrationState(store, un) {
  const [state, cache] = await Promise.all([
    store.get(`integrations:${un}`),
    store.get(`gcal:${un}`),
  ]);
  const c = loadCache(cache);
  return {
    connected: Boolean(state?.connected),
    email: state?.email ?? null,
    events: c.events,
    fetchedAt: c.fetchedAt,
  };
}
