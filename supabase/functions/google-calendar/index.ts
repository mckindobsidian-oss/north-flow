// ══════════════════════════════════════════════════════════════════════════
// NORTH — google-calendar Edge Function (Deno).
//
// The ONLY place Google's client secret and the user's OAuth tokens exist.
// Deploy with: supabase functions deploy google-calendar
// Secrets:     supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
// REQUIRES:    supabase/config.toml keeps `[functions.google-calendar]
//              verify_jwt = false`. The start/callback legs are BROWSER
//              REDIRECTS and cannot carry an Authorization header, so with
//              gateway verification on they die with a platform 401 before
//              this code runs and connecting is impossible. This function
//              authorizes those two legs itself (JWT for `start`, its own
//              HMAC-signed expiring state for `callback`); every other
//              action still requires the caller's JWT.
//
// ENDPOINTS (single function, ?action= dispatcher):
//   GET  …/google-calendar?action=start        → 302 to Google's consent screen
//   GET  …/google-calendar?action=callback     → Google redirects here; tokens
//                                                stored in Vault; 302 back to app
//   POST …/google-calendar?action=events       → proxied calendar fetch
//   POST …/google-calendar?action=disconnect   → revoke + delete tokens/row
//   GET  …/google-calendar?action=status       → { connected, email } probe
//
// SECURITY MODEL
//   · The caller's Supabase JWT identifies them — every query is their own
//     row. RLS still protects the table; this function holds service_role
//     only to read/write Vault, never to bypass row ownership.
//   · Tokens are stored in Vault (_secret), not in any table. The client
//     receives only connected state + account email.
//   · Scopes are the minimum: calendar.readonly (read the calendars the user
//     can see, and nothing else) + userinfo.email (identity). North never
//     creates, edits or deletes a Google event, so no write scope is asked
//     for — and deliberately not calendar.events, which is read+WRITE.
//   · An expired refresh token (user revoked at Google) surfaces as a clean
//     { connected: false } and the connection row is deleted.
// ══════════════════════════════════════════════════════════════════════════

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly", // READ ONLY — import events
  "https://www.googleapis.com/auth/userinfo.email",     // which Google account connected
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** The project ref from the request host, e.g. qrytz….supabase.co. */
function projectRef(req: Request): string {
  return new URL(req.url).hostname.split(".")[0];
}

// ── signed OAuth state ───────────────────────────────────────────────────
// The `state` parameter is how the callback knows WHO the grant belongs to
// and WHERE to send the browser afterwards. A state anyone could forge would
// let a caller bind a Google grant to a user id they never proved, so the
// payload is signed with the Google client secret (server-side only — the
// browser and Google only ever see opaque base64) and carries an expiry.
// Nothing sensitive rides in it: a user id and an app origin.
const b64urlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "");
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload only when the signature AND the expiry check pass. */
async function verifyState(state: string): Promise<{ u: string; app: string } | null> {
  const [body, sig] = String(state).split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload?.u || Number(payload.exp) < Date.now()) return null;
    return { u: String(payload.u), app: String(payload.app ?? "") };
  } catch {
    return null;
  }
}

/**
 * Vault read/write — tokens never touch a table.
 *
 * Vault is reached through the three service-role-only SECURITY DEFINER RPCs
 * that migration 004 creates (`north_secret_put` / `_get` / `_del`). NOT
 * through a raw PostgREST call into the `vault` schema — that never worked:
 *   · PostgREST does not serve the `vault` schema (it is not in db-schemas),
 *     so the request does not resolve at all; and
 *   · `vault.secrets.secret` stores pgsodium CIPHERTEXT. A plaintext insert
 *     there is not decryptable, so every read came back empty and a connected
 *     account silently behaved like a disconnected one.
 * The RPCs call vault.create_secret / vault.update_secret / decrypted_secrets
 * — the supported path — so the value we write is the value we read back.
 */
const secretName = (userId: string) => `gcal/${userId}`;

async function secretRpc(ref: string, fn: string, args: Record<string, unknown>, serviceKey: string): Promise<Response> {
  return fetch(`https://${ref}.supabase.co/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

async function vaultPut(ref: string, serviceKey: string, userId: string, value: unknown) {
  const res = await secretRpc(ref, "north_secret_put", { p_name: secretName(userId), p_secret: JSON.stringify(value) }, serviceKey);
  if (!res.ok) throw new Error(`vault write failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

async function vaultGet(ref: string, serviceKey: string, userId: string): Promise<{ access_token: string; refresh_token: string; expiry: number } | null> {
  const res = await secretRpc(ref, "north_secret_get", { p_name: secretName(userId) }, serviceKey);
  if (!res.ok) return null;
  const raw = await res.json().catch(() => null);
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function vaultDel(ref: string, serviceKey: string, userId: string) {
  await secretRpc(ref, "north_secret_del", { p_name: secretName(userId) }, serviceKey).catch(() => {});
}

/**
 * Which Google account granted this? Display-only — identity always comes from
 * the signed state, never from Google.
 *
 * Ask the userinfo endpoint with the access token we just received. The
 * earlier implementation decoded `tokens.id_token`, but Google only returns an
 * id_token when the `openid` scope is requested, and NORTH asks for exactly
 * two scopes (calendar.readonly + userinfo.email) and deliberately nothing
 * more. So that decode always fell through its `?? "e30="` default and stored
 * an EMPTY email for every connection. The userinfo endpoint is what the
 * already-granted `userinfo.email` scope actually authorises.
 *
 * Best-effort by design: failing to learn a display name must never fail the
 * connection, so every error path here returns "".
 */
async function googleEmail(accessToken: string): Promise<string> {
  if (!accessToken) return "";
  // v2 is the non-OIDC userinfo endpoint — the one `userinfo.email` unlocks.
  // openidconnect/v1 is tried second so this keeps working if the `openid`
  // scope is ever added. Endpoint choice must never be able to break
  // connecting.
  for (const endpoint of [
    "https://www.googleapis.com/oauth2/v2/userinfo",
    "https://openidconnect.googleapis.com/v1/userinfo",
  ]) {
    try {
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) continue;
      const email = String(((await res.json()) as any)?.email ?? "").trim();
      if (email) return email;
    } catch { /* try the next endpoint */ }
  }
  return "";
}

/** Exchange/refresh via Google's token endpoint. */
async function tokenRequest(ref: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(String((data as any)?.error || `token endpoint ${res.status}`));
  return data as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const ref = projectRef(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const admin = { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" } };

  // ── browser legs (start/callback) need no caller JWT ────────────────────
  if (action === "start") {
    if (!clientId || !clientSecret) return json({ error: "google_calendar_not_configured" }, 501);
    // Only a signed-in NORTH user may begin a connection. Their JWT (header or
    // query param — a browser redirect cannot set headers) is verified HERE,
    // and only the verified user id is bound into the signed state below, so
    // the callback never has to trust anything arriving through Google.
    const startJwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "") || url.searchParams.get("jwt") || "";
    if (!startJwt) return json({ error: "unauthorized" }, 401);
    const caller = await fetch(`https://${ref}.supabase.co/auth/v1/user`, {
      headers: { Authorization: `Bearer ${startJwt}`, apikey: serviceKey },
    });
    if (!caller.ok) return json({ error: "unauthorized" }, 401);
    const northUserId = String((await caller.json()).id ?? "");
    if (!northUserId) return json({ error: "unauthorized" }, 401);

    const functionBase = `https://${ref}.functions.supabase.co/google-calendar`;
    const redirectUri = `${functionBase}?action=callback`;
    const appOrigin = url.searchParams.get("app") ?? "";
    const state = await signState({ u: northUserId, app: appOrigin, exp: Date.now() + 3600_000 });
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPES.join(" "));
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { Location: auth.toString(), ...CORS } });
  }

  if (action === "callback") {
    const code = url.searchParams.get("code");
    // The signed state — not any URL parameter — is the only source of the
    // NORTH user this grant belongs to. A forged or stale state fails closed.
    const claimed = await verifyState(url.searchParams.get("state") ?? "");
    if (!code || !claimed?.u) return new Response("Missing code or invalid state", { status: 400, headers: CORS });
    const app = claimed.app;
    const back = (suffix: string) =>
      app ? `${app}${app.includes("?") ? "&" : "?"}${suffix}` : null;
    try {
      const tokens = await tokenRequest(ref, new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: `https://${ref}.functions.supabase.co/google-calendar?action=callback`,
        grant_type: "authorization_code",
      }));
      // Who granted? Display only — see googleEmail(). Never used for identity.
      const email = await googleEmail(String(tokens.access_token ?? ""));

      await vaultPut(ref, serviceKey, claimed.u, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      });
      // PROVE the round trip: read the secret back through the same bridge and
      // confirm the refresh token survived encryption. A grant we cannot
      // persist is not a connection, and reporting one anyway would be a lie
      // the UI then repeats to the user.
      const readBack = await vaultGet(ref, serviceKey, claimed.u);
      if (!readBack?.refresh_token) throw new Error("token_persist_failed");

      // Upsert the public connection row (RLS table, service insert) —
      // scoped to this provider so Spotify's row is never touched. POST +
      // merge-duplicates, not PATCH: PATCH matches zero rows when the
      // connection is new and would leave the token pointing at nothing.
      const upsert = await fetch(`https://${ref}.supabase.co/rest/v1/integrations`, {
        method: "POST",
        headers: { ...admin, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          user_id: claimed.u, provider: "google_calendar",
          account_email: email, scope: String(tokens.scope ?? SCOPES.join(" ")),
          connected_at: new Date().toISOString(),
        }),
      });
      if (!upsert.ok) {
        // Without the row the app can never report this connection, so roll
        // the secret back rather than leaving a token bound to nothing.
        await vaultDel(ref, serviceKey, claimed.u);
        throw new Error(`integration row write failed: ${upsert.status}`);
      }

      const ok = back("gcal=connected");
      if (!ok) return json({ connected: true });
      return new Response(null, { status: 302, headers: { Location: ok, ...CORS } });
    } catch {
      const err = back("gcal=error");
      if (!err) return json({ error: "callback_failed" }, 500);
      return new Response(null, { status: 302, headers: { Location: err, ...CORS } });
    }
  }

  // ── authenticated legs below: the caller's JWT defines the user ─────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const userRes = await fetch(`https://${ref}.supabase.co/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey },
  });
  if (!userRes.ok) return json({ error: "unauthorized" }, 401);
  const northUser = await userRes.json();
  const userId = northUser.id as string;

  async function accessToken(): Promise<string> {
    let t = await vaultGet(ref, serviceKey, userId);
    if (!t?.refresh_token) throw new Error("not_connected");
    // Still valid for another minute? Use it as-is, no network round trip.
    if (Date.now() < (t.expiry ?? 0) - 60000) return t.access_token;
    const fresh = await tokenRequest(ref, new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }));
    t = { access_token: String(fresh.access_token), refresh_token: t.refresh_token, expiry: Date.now() + Number(fresh.expires_in ?? 3600) * 1000 };
    await vaultPut(ref, serviceKey, userId, t);
    return t.access_token;
  }

  try {
    if (action === "events") {
      const { timeMin, timeMax, cache } = await req.json().catch(() => ({} as any));
      let token: string;
      try { token = await accessToken(); } catch {
        // Not connected, or Google revoked the grant → clean state, not a 500.
        // Provider-scoped: this function owns only its own connection row.
        await fetch(`https://${ref}.supabase.co/rest/v1/integrations?user_id=eq.${userId}&provider=eq.google_calendar`, { method: "DELETE", headers: admin });
        await vaultDel(ref, serviceKey, userId);
        return json({ connected: false });
      }
      const cal = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      cal.searchParams.set("timeMin", String(timeMin ?? new Date(Date.now() - 7 * 864e5).toISOString()));
      cal.searchParams.set("timeMax", String(timeMax ?? new Date(Date.now() + 60 * 864e5).toISOString()));
      cal.searchParams.set("singleEvents", "true");
      cal.searchParams.set("orderBy", "startTime");
      cal.searchParams.set("maxResults", "250");
      const gres = await fetch(cal, { headers: { Authorization: `Bearer ${token}` } });
      if (gres.status === 401 || gres.status === 403) {
        await fetch(`https://${ref}.supabase.co/rest/v1/integrations?user_id=eq.${userId}&provider=eq.google_calendar`, { method: "DELETE", headers: admin });
        await vaultDel(ref, serviceKey, userId);
        return json({ connected: false });
      }
      if (!gres.ok) return json({ error: `google ${gres.status}` }, 502);
      const data = await gres.json();
      return json({ connected: true, events: data.items ?? [], fetchedAt: new Date().toISOString() });
    }

    if (action === "status") {
      const row = await fetch(`https://${ref}.supabase.co/rest/v1/integrations?user_id=eq.${userId}&provider=eq.google_calendar&select=account_email,connected_at`, { headers: admin });
      const rows = await row.json().catch(() => []);
      if (!rows?.length) return json({ connected: false });
      // Prove the grant still works; a dead token cleans itself up here too.
      try { await accessToken(); } catch {
        await fetch(`https://${ref}.supabase.co/rest/v1/integrations?user_id=eq.${userId}&provider=eq.google_calendar`, { method: "DELETE", headers: admin });
        await vaultDel(ref, serviceKey, userId);
        return json({ connected: false });
      }
      return json({ connected: true, account_email: rows[0].account_email, connected_at: rows[0].connected_at });
    }

    if (action === "disconnect") {
      try {
        const t = await vaultGet(ref, serviceKey, userId);
        if (t?.access_token) {
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: t.access_token }),
          });
        }
      } catch { /* revocation best-effort */ }
      await fetch(`https://${ref}.supabase.co/rest/v1/integrations?user_id=eq.${userId}&provider=eq.google_calendar`, { method: "DELETE", headers: admin });
      await vaultDel(ref, serviceKey, userId);
      return json({ connected: false });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
