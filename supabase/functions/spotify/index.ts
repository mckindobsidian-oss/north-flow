// ══════════════════════════════════════════════════════════════════════════
// NORTH — Spotify Edge Function (Deno).
//
// Same security model as google-calendar: the client secret and the user's
// tokens live only here (tokens in Vault per user), the caller's Supabase
// JWT identifies them, and the browser learns only connection state + what
// it asks for.
//
// Deploy:  supabase functions deploy spotify
// Secrets: supabase secrets set SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=…
// Dashboard: Spotify Developer Dashboard → your app → Redirect URIs must
//   include https://<ref>.functions.supabase.co/spotify?action=callback
//   Scopes requested (minimum): user-read-playback-state,
//   user-modify-playback-state, user-read-email.
//
// LIMITATION (Spotify's rule, not ours): control endpoints (play/pause/next)
// require the caller to have Spotify Premium; free accounts can connect and
// see the current track but playback control returns 403 — surfaced honestly
// as { premiumRequired: true }.
// ══════════════════════════════════════════════════════════════════════════

const SCOPES = "user-read-playback-state user-modify-playback-state user-read-email";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ── signed OAuth state (same model as google-calendar) ──────────────────
// The `state` parameter is the ONLY way the callback knows which NORTH user
// the grant belongs to and where to send the browser. Passing a raw app URL
// through as state would let anyone bind a Spotify grant (or a hostile
// redirect) to an arbitrary user id, so the payload is HMAC-signed with the
// Spotify client secret (server-side only) and carries an expiry.
const b64urlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(clientSecret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(clientSecret);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signState(clientSecret: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(clientSecret), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Payload only when the signature AND the expiry check pass. */
async function verifyState(clientSecret: string, state: string): Promise<{ u: string; app: string } | null> {
  const [body, sig] = String(state).split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(clientSecret), b64urlDecode(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload?.u || Number(payload.exp) < Date.now()) return null;
    return { u: String(payload.u), app: String(payload.app ?? "") };
  } catch {
    return null;
  }
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const ref = (req: Request) => new URL(req.url).hostname.split(".")[0];
const basicAuth = (id: string, sec: string) => `Basic ${btoa(`${id}:${sec}`)}`;

/**
 * Vault access — the same service-role-only RPC bridge the calendar function
 * uses (migration 004: north_secret_put/get/del). The previous raw
 * `rest/v1/vault/secrets` calls could not work: PostgREST does not serve the
 * `vault` schema, and `secrets.secret` holds pgsodium ciphertext, so a
 * plaintext insert was never decryptable — a "connected" Spotify account
 * silently read back as disconnected.
 */
const secretRpc = (ref_: string, fn: string, args: Record<string, unknown>, serviceKey: string) =>
  fetch(`https://${ref_}.supabase.co/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

async function vault(ref_: string, key: string, serviceKey: string, method = "GET", body?: unknown) {
  const p_name = `spotify/${key}`;
  if (method === "GET") {
    const res = await secretRpc(ref_, "north_secret_get", { p_name }, serviceKey);
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    if (typeof raw !== "string" || !raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  if (method === "DELETE") {
    await secretRpc(ref_, "north_secret_del", { p_name }, serviceKey).catch(() => {});
    return null;
  }
  await secretRpc(ref_, "north_secret_put", { p_name, p_secret: JSON.stringify(body) }, serviceKey).catch(() => {});
  return null;
}

async function northUser(req: Request, ref_: string, serviceKey: string) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const res = await fetch(`https://${ref_}.supabase.co/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey },
  });
  return res.ok ? res.json() : null;
}

async function accessToken(req: Request, ref_: string, serviceKey: string, userId: string, clientId: string, clientSecret: string): Promise<string> {
  let t = await vault(ref_, userId, serviceKey);
  if (!t?.refresh_token) throw new Error("not_connected");
  if (Date.now() < (t.expiry ?? 0) - 60000) return t.access_token;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(String((data as any)?.error ?? `token ${res.status}`));
  t = { access_token: data.access_token, refresh_token: data.refresh_token ?? t.refresh_token, expiry: Date.now() + data.expires_in * 1000 };
  await vault(ref_, userId, serviceKey, "PUT", t);
  return t.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const r = ref(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (action === "start") {
    if (!clientId || !clientSecret) return json({ error: "spotify_not_configured" }, 501);
    // Only a signed-in NORTH user may begin a connection — the JWT (header or
    // query param, since a browser redirect cannot set headers) is verified
    // HERE, and only the verified user id is bound into the signed state.
    const startJwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "") || url.searchParams.get("jwt") || "";
    if (!startJwt) return json({ error: "unauthorized" }, 401);
    const caller = await fetch(`https://${r}.supabase.co/auth/v1/user`, {
      headers: { Authorization: `Bearer ${startJwt}`, apikey: serviceKey },
    });
    if (!caller.ok) return json({ error: "unauthorized" }, 401);
    const northUserId = String((await caller.json()).id ?? "");
    if (!northUserId) return json({ error: "unauthorized" }, 401);

    const appOrigin = url.searchParams.get("app") ?? "";
    const state = await signState(clientSecret, { u: northUserId, app: appOrigin, exp: Date.now() + 3600_000 });
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("redirect_uri", `https://${r}.functions.supabase.co/spotify?action=callback`);
    auth.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { Location: auth.toString(), ...CORS } });
  }

  if (action === "callback") {
    const code = url.searchParams.get("code");
    // The signed state — not any URL parameter — is the only source of the
    // NORTH user this grant belongs to. A forged or stale state fails closed.
    const claimed = await verifyState(clientSecret ?? "", url.searchParams.get("state") ?? "");
    if (!code || !claimed?.u) {
      const app = claimed?.app ?? "";
      return new Response(null, { status: 302, headers: { Location: `${app}${app.includes("?") ? "&" : "?"}spotify=error` } });
    }
    const app = claimed.app;
    try {
      const tok = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: basicAuth(clientId!, clientSecret!),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code", code,
          redirect_uri: `https://${r}.functions.supabase.co/spotify?action=callback`,
        }),
      });
      const data = await tok.json();
      if (!tok.ok) throw new Error("token_exchange_failed");
      const northId = claimed.u;
      const origin = app;
      await vault(r, northId, serviceKey, "PUT", {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expiry: Date.now() + data.expires_in * 1000,
      });
      await fetch(`https://${r}.supabase.co/rest/v1/integrations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          user_id: northId, provider: "spotify",
          account_email: null, scope: SCOPES, connected_at: new Date().toISOString(),
        }),
      });
      return new Response(null, { status: 302, headers: { Location: `${origin}${origin.includes("?") ? "&" : "?"}spotify=connected` } });
    } catch {
      const origin = app || "";
      return new Response(null, { status: 302, headers: { Location: `${origin}${origin.includes("?") ? "&" : "?"}spotify=error` } });
    }
  }

  // ── authenticated legs ───────────────────────────────────────────────────
  const me = await northUser(req, r, serviceKey);
  if (!me) return json({ error: "unauthorized" }, 401);
  const clientId2 = clientId!;
  const clientSecret2 = clientSecret!;

  const cleanup = async () => {
    await fetch(`https://${r}.supabase.co/rest/v1/integrations?user_id=eq.${me.id}&provider=eq.spotify`, {
      method: "DELETE", headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    await vault(r, me.id, serviceKey, "DELETE");
  };

  const sp = async (path: string, init?: RequestInit) => {
    const token = await accessToken(req, r, serviceKey, me.id, clientId2, clientSecret2);
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && (body as any)?.error?.reason === "PREMIUM_REQUIRED") throw new Error("premium_required");
      if (res.status === 401) { await cleanup(); throw new Error("not_connected"); }
    }
    return res;
  };

  try {
    if (action === "status") {
      try { await accessToken(req, r, serviceKey, me.id, clientId2, clientSecret2); } catch { await cleanup(); return json({ connected: false }); }
      return json({ connected: true });
    }
    if (action === "disconnect") {
      try { const t = await vault(r, me.id, serviceKey); if (t?.access_token) await fetch("https://accounts.spotify.com/api/token", { method: "DELETE" }).catch(() => {}); } catch {}
      await cleanup();
      return json({ connected: false });
    }
    if (action === "playback") {
      const res = await sp("/me/player?additional_types=track");
      if (res.status === 204) return json({ connected: true, playing: null });
      const data = await res.json();
      return json({
        connected: true,
        playing: data?.item ? {
          title: data.item.name,
          artist: (data.item.artists ?? []).map((a: any) => a.name).join(", "),
          album: data.item.album?.name,
          progressMs: data.progress_ms ?? 0,
          durationMs: data.item.duration_ms ?? 0,
          isPlaying: Boolean(data.is_playing),
          url: data.item.external_urls?.spotify,
        } : null,
        device: data?.device?.name ?? null,
      });
    }
    const control: Record<string, [string, string]> = {
      play: ["/me/player/play", "PUT"],
      pause: ["/me/player/pause", "PUT"],
      next: ["/me/player/next", "POST"],
      previous: ["/me/player/previous", "POST"],
    };
    if (action in control) {
      const [path, method] = control[action];
      const res = await sp(path, { method, body: method === "PUT" && action === "play" ? "{}" : undefined });
      return json({ ok: res.ok || res.status === 204 });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return json({ error: msg, premiumRequired: msg === "premium_required" }, msg === "not_connected" ? 200 : 502);
  }
});
