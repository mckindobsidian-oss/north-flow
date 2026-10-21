/**
 * NORTH — Spotify client connector (same pattern as integrations.js).
 *
 * The browser holds no client secret and no tokens: OAuth and playback run
 * through the `spotify` Edge Function, which keeps per-user tokens in Vault.
 * The client caches only { connected } plus the last playback snapshot for
 * offline-safe rendering (music controls simply do nothing offline — never
 * faked).
 *
 * PREMIUM LIMITATION (Spotify's rule): play/pause/next/previous require the
 * connected account to have Spotify Premium. Free accounts connect and see
 * the current track; control responses surface premiumRequired honestly.
 */
import { supabase, supabaseConfigured, normalizedUrl } from "./supabase.js";

const FN = "spotify";

function fnUrl() {
  return `${String(normalizedUrl).replace(/\/+$/, "")}/functions/v1/${FN}`;
}

async function call(action, body) {
  if (!supabaseConfigured || !supabase) throw new Error("not_configured");
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess?.session?.access_token;
  if (!jwt) throw new Error("signed_out");
  const res = await fetch(`${fnUrl()}?action=${action}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 404 || data?.code === "NOT_FOUND"
    ? "Spotify service isn't deployed at the configured project."
    : data?.error || `Spotify service unavailable (${res.status})`);
  return data;
}

/**
 * Connect: the start leg embeds the NORTH user id in the OAuth state so the
 * callback can associate the grant without any client-side token handling.
 */
export async function connectSpotify() {
  if (!supabaseConfigured || !supabase) throw new Error("not_configured");
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess?.session?.access_token;
  if (!jwt) throw new Error("signed_out");
  // The server verifies the JWT itself and signs the OAuth state with the
  // verified user id inside — the browser never declares who it is.
  const u = new URL(`${fnUrl()}?action=start`);
  u.searchParams.set("app", window.location.origin + window.location.pathname);
  u.searchParams.set("jwt", jwt);
  window.location.assign(u.toString());
}

export async function spotifyStatus() {
  try { return await call("status"); } catch (e) {
    if (e?.message === "not_configured" || e?.message === "signed_out") return { connected: false, unavailable: true };
    return { connected: false, error: String(e?.message ?? e) };
  }
}

export async function disconnectSpotify() {
  return call("disconnect");
}

/** Current playback snapshot, or { playing: null } when nothing is active. */
export async function spotifyPlayback() {
  return call("playback");
}

/** play | pause | next | previous. Throws premium_required for free accounts. */
export async function spotifyControl(action) {
  return call(action);
}
