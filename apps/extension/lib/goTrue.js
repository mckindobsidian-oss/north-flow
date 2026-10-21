/**
 * NORTH extension — minimal GoTrue (Supabase Auth) REST client.
 *
 * WHY THIS EXISTS
 * The MV3 service worker loads plain ES modules — there is no bundler step, so
 * `import … from "@supabase/supabase-js"` cannot resolve and the whole worker
 * would fail to start. Supabase Auth is, underneath, a small documented HTTP
 * API (GoTrue), and everything this extension needs is the session lifecycle:
 *
 *   POST /auth/v1/token?grant_type=refresh_token → renew an expired session
 *   POST /auth/v1/logout                      → revoke the refresh token
 *   GET  /auth/v1/user                        → verify the handed-off session
 *
 * This file speaks exactly that protocol. No tokens are ever logged, and the
 * session lives in chrome.storage.local under one key so it survives worker
 * termination — the persistence story an MV3 worker needs.
 *
 * SECURITY NOTES
 *  - The anon key is public by design (RLS is the boundary), sent as `apikey`.
 *  - The access token (JWT) is sent as `Authorization: Bearer …`.
 *  - `refresh_token` is the long-lived secret; it never leaves storage except
 *    to Supabase over HTTPS.
 */

const MINUTE = 60 * 1000;

/** Extract the JWT payload (for `exp` scheduling only — never for trust). */
export function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Create an auth handle bound to one project + storage key.
 * `storage` must implement get/set/remove like chrome.storage.local wrappers do.
 */
export function createGoTrue({ url, anonKey, storage, sessionKey }) {
  const base = `${String(url).replace(/\/+$/, "")}/auth/v1`;

  const readSession = async () => {
    const got = await storage.get(sessionKey);
    return got?.[sessionKey] ?? null;
  };
  const writeSession = (session) =>
    session ? storage.set({ [sessionKey]: session }) : storage.remove(sessionKey);

  /** One authenticated REST call with the freshest access token. */
  async function authedFetch(path, { method = "GET", body, jwt } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error_description || data?.msg || data?.message || data?.error || `auth ${res.status}`;
      throw new Error(String(msg));
    }
    return data;
  }

  return {
    /** Revoke the refresh token server-side and drop the local session. */
    async signOut() {
      const session = await readSession();
      try {
        if (session?.access_token) {
          await authedFetch("/logout", { method: "POST", jwt: session.access_token });
        }
      } catch { /* already revoked/expired — local removal still happens */ }
      await writeSession(null);
    },

    /** The current session, refreshing through Supabase when it has expired. */
    async getSession() {
      let session = await readSession();
      if (!session?.access_token) return { session: null };
      const exp = decodeJwtPayload(session.access_token)?.exp;
      const expiresAtMs = exp ? exp * 1000 : 0;
      if (expiresAtMs && Date.now() < expiresAtMs - MINUTE) return { session };
      // Expired (or expiring within a minute): renew once. A refresh token
      // revoked elsewhere (sign-out on another device, password change) fails
      // here and yields a clean signed-out state instead of a stuck session.
      if (!session.refresh_token) { await writeSession(null); return { session: null }; }
      try {
        const fresh = await authedFetch("/token?grant_type=refresh_token", {
          method: "POST",
          body: { refresh_token: session.refresh_token },
        });
        if (fresh?.access_token) {
          await writeSession(fresh);
          return { session: fresh };
        }
      } catch { /* fall through to signed-out */ }
      await writeSession(null);
      return { session: null };
    },

    /** The verified user for the current session (null when signed out). */
    async getUser() {
      const { session } = await this.getSession();
      if (!session?.access_token) return null;
      try {
        return (await authedFetch("/user", { jwt: session.access_token })) ?? null;
      } catch {
        return null;
      }
    },

    /** Validate a session received through North's one-use extension handoff. */
    async adoptSession(session) {
      if (!session?.access_token || !session?.refresh_token) throw new Error("North did not provide a complete sign-in session.");
      let accepted = session;
      let user;
      try {
        user = await authedFetch("/user", { jwt: accepted.access_token });
      } catch {
        // Recover once if the handed-off access token belongs to a just-revoked
        // session. The replacement is still verified before anything is saved.
        accepted = await authedFetch("/token?grant_type=refresh_token", {
          method: "POST",
          body: { refresh_token: session.refresh_token },
        });
        user = await authedFetch("/user", { jwt: accepted.access_token });
      }
      if (!user?.id) throw new Error("The North website session could not be verified.");
      await writeSession(accepted);
      return user;
    },
  };
}
