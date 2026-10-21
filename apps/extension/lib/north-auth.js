/**
 * NORTH extension — real account authentication.
 *
 * The MV3 worker loads plain ES modules (no bundler), so an npm SDK import
 * cannot resolve there. Real auth still works: lib/goTrue.js speaks the
 * documented GoTrue REST protocol directly (password grant, token refresh,
 * logout, /user) over fetch, and keeps the session in chrome.storage.local so
 * it survives worker termination — the persistence story an MV3 worker needs.
 * No plaintext tokens are ever logged, and there is no service_role anywhere.
 *
 * The website session arrives through an explicit, one-use extension pairing.
 *
 * Public values only (project URL + anon key) — paired automatically from the
 * exact North website origin; no manual key-pasting screen is needed.
 */
import { createGoTrue } from "./goTrue.js";

const KEYS = {
  url: "northSupabaseUrl",
  key: "northSupabaseAnonKey",
  session: "northAuthSession",
};

/** chrome.storage.local shaped like the { get/set/remove } adapter GoTrue wants. */
const chromeStorage = {
  get: async (k) => (await chrome.storage.local.get(k)),
  set: async (obj) => { await chrome.storage.local.set(obj); },
  remove: async (k) => { await chrome.storage.local.remove(k); },
};

let client = null;

export function validateProjectConfig(url, anonKey) {
  const endpoint = new URL(String(url || "").trim());
  const local = ["localhost", "127.0.0.1"].includes(endpoint.hostname);
  if (!((endpoint.protocol === "https:" || local && endpoint.protocol === "http:") && endpoint.pathname === "/" && !endpoint.search && !endpoint.hash)) {
    throw new Error("North supplied an invalid account service URL.");
  }
  const key = String(anonKey || "").trim();
  if (!key || /^sb_secret_/i.test(key) || /service_role/i.test(key)) {
    throw new Error("North did not supply a public account key.");
  }
  return { url: endpoint.origin, key };
}

/** The persisted GoTrue session, or null (used by the sync layer's JWT calls). */
export async function getSession() {
  if (!client) return null;
  try {
    const { session } = await client.getSession();
    return session;
  } catch {
    return null;
  }
}

/** Initialize from stored public config. Returns whether accounts are live. */
export async function initAuth() {
  const { [KEYS.url]: url, [KEYS.key]: anonKey } = await chrome.storage.local.get([KEYS.url, KEYS.key]);
  if (!url || !anonKey) return false;
  client = createGoTrue({ url, anonKey, storage: chromeStorage, sessionKey: KEYS.session });
  return true;
}

export const isConfigured = () => Boolean(client);

/** Restore the persisted session (null when signed out / expired+unrefreshable). */
export async function getSessionUser() {
  if (!client) return null;
  try {
    return await client.getUser();
  } catch {
    return null;
  }
}

/** Adopt the already-authenticated North website account after server validation. */
export async function adoptSession(session) {
  if (!client) throw new Error("Connect to North again to set up account sync.");
  const user = await client.adoptSession(session);
  return { id: user.id, email: user.email || "" };
}

export async function signOut() {
  try { if (client) await client.signOut(); } catch { /* already gone */ }
}

/** Store/clear the public project config (account card). */
export async function setConfig(url, anonKey, webUrl) {
  const config = validateProjectConfig(url, anonKey);
  const cleanUrl = config.url;
  const old = await chrome.storage.local.get([KEYS.url, KEYS.key]);
  const changed = Boolean(old[KEYS.url] && (old[KEYS.url] !== cleanUrl || old[KEYS.key] !== config.key));
  if (changed) {
    await signOut();
    await chrome.storage.local.remove([KEYS.session, "northAccount"]);
  }
  await chrome.storage.local.set({
    [KEYS.url]: cleanUrl,
    [KEYS.key]: config.key,
  });
  // Where "Open North Flow" points, from the popup and from the block page.
  // Optional: an empty value clears it back to the deployed default, so the
  // two never disagree about where North lives.
  const web = String(webUrl || "").trim().replace(/\/+$/, "");
  if (web) await chrome.storage.local.set({ northWebUrl: web });
  else await chrome.storage.local.remove("northWebUrl");
  return initAuth();
}
