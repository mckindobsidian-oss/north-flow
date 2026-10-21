/**
 * NORTH — talking to the browser extension.
 *
 * WHY THE WEB APP TALKS TO AN EXTENSION AT ALL
 * A web page cannot block a website; the browser can. So North Guard configures
 * rules and the extension enforces them — and the only thing this module does
 * is keep those two in step: tell the extension "something changed, look at the
 * account again", and ask it "are you there, and what are you enforcing?".
 *
 * Session pairing is a separate, explicit one-use message; ordinary sync
 * requests remain read-only and cannot change blocking state directly.
 *
 * WHY AN ID IS HARD-CODED
 * `chrome.runtime.sendMessage` needs the *extension* id, which Chrome normally
 * assigns per install. The extension ships a `key` in its manifest, which pins
 * its id for every unpacked install — so this constant is stable. Installing
 * from a store instead produces a different id; the Flow screen lets you paste
 * that one, and everything here keeps working.
 */

/**
 * The extension's pinned id: sha256 of the DER public key in its manifest, first
 * 16 bytes, each nibble mapped `0-f → a-p`.
 *
 * `npm run verify:extension` asserts a running browser reports this same id, so
 * a store-installed build (which gets a different one) shows up as a failed
 * check rather than as a channel that quietly never works. The Flow screen also
 * lets you paste yours in, which takes precedence over this default.
 */
export const EXTENSION_ID = "hmnbjpojnjdbjjiaocljplajihennmaa";

/** Where the id can be overridden at runtime (device-local, never account data). */
const ID_KEY = "fl_ext_id";

/** The channel Chrome injects only into origins listed in `externally_connectable`. */
const runtime = () => {
  try {
    return globalThis.chrome?.runtime?.sendMessage ? globalThis.chrome.runtime : null;
  } catch {
    return null;
  }
};

/**
 * Is there any chance an extension is listening? True only on a North origin
 * that Chrome recognised — it does not prove the extension is installed.
 */
export const extensionChannelOpen = () => Boolean(runtime());

/** The id to address, honouring a pasted override from the Flow screen. */
export function extensionId() {
  try {
    return globalThis.localStorage?.getItem(ID_KEY) || EXTENSION_ID;
  } catch {
    return EXTENSION_ID;
  }
}

export function setExtensionId(id) {
  try {
    const v = String(id || "").trim();
    if (v) globalThis.localStorage.setItem(ID_KEY, v);
    else globalThis.localStorage.removeItem(ID_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the extension for its status.
 *
 * Resolves — never rejects — with `{ installed: false, reason }` for every
 * failure mode that is not an error the user can act on: no channel (the origin
 * isn't connectable), no receiver (not installed), or a timeout (the worker was
 * asleep and did not wake in time). The Flow screen renders that honestly
 * instead of implying the extension is enforcing when it is not.
 */
export function pingExtension(timeoutMs = 900) {
  const rt = runtime();
  if (!rt) return Promise.resolve({ installed: false, reason: "no_channel" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish({ installed: false, reason: "timeout" }), timeoutMs);
    try {
      rt.sendMessage(extensionId(), { type: "north-ping" }, (res) => {
        clearTimeout(timer);
        // `lastError` must be read inside the callback, and it is how "no
        // receiving end" (i.e. not installed) arrives — not an exception.
        const err = rt.lastError;
        if (err) return finish({ installed: false, reason: err.message || "no_receiver" });
        if (!res?.ok) return finish({ installed: false, reason: res?.error || "no_response" });
        finish({ installed: true, ...res });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ installed: false, reason: String(e?.message || e) });
    }
  });
}

/** Read only this browser's local daily website usage from the extension. */
export function readExtensionUsage(timeoutMs = 1500) {
  const rt = runtime();
  if (!rt) return Promise.resolve({ installed: false, reason: "no_channel" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => finish({ installed: false, reason: "timeout" }), timeoutMs);
    try {
      rt.sendMessage(extensionId(), { type: "north-usage" }, (res) => {
        clearTimeout(timer);
        const err = rt.lastError;
        if (err) return finish({ installed: false, reason: err.message || "no_receiver" });
        finish(res?.ok ? { installed: true, ...res } : { installed: false, reason: res?.error || "no_response" });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ installed: false, reason: String(e?.message || e) });
    }
  });
}

/**
 * Tell the extension to reconcile now — after a rule edit, or when a focus
 * session starts or ends, so enforcement follows within a second instead of at
 * the next background refresh. Fire-and-forget by design: a missing extension
 * must never make saving a rule fail.
 */
export function notifyExtension(type = "north-sync") {
  const rt = runtime();
  if (!rt) return false;
  try {
    rt.sendMessage(extensionId(), { type }, () => {
      // Reading lastError keeps Chrome from logging an unchecked-error warning
      // when nothing is installed.
      void rt.lastError;
    });
    return true;
  } catch {
    return false;
  }
}

/** Reconcile now and return the worker's real account-sync result to the UI. */
export function requestExtensionSync(timeoutMs = 7000) {
  const rt = runtime();
  if (!rt) return Promise.resolve({ ok: false, reason: "no_channel" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    try {
      rt.sendMessage(extensionId(), { type: "north-sync" }, (result) => {
        clearTimeout(timer);
        const error = rt.lastError;
        finish(error ? { ok: false, reason: error.message || "no_receiver" } : result || { ok: false, reason: "no_response" });
      });
    } catch (error) {
      clearTimeout(timer);
      finish({ ok: false, reason: String(error?.message || error) });
    }
  });
}

/** Transfer the already-authenticated North session through a one-use local pairing request. */
export function connectExtensionAccount({ url, anonKey, webUrl, targetId, nonce, session }) {
  const rt = runtime();
  if (!rt || !url || !anonKey || !session?.access_token || !session?.refresh_token || !/^[a-p]{32}$/.test(String(targetId))) {
    return Promise.resolve({ ok: false, reason: "unavailable" });
  }
  const { access_token, refresh_token, token_type, expires_in, expires_at, user } = session;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 10000);
    try {
      rt.sendMessage(targetId, {
        type: "north-connect", extensionId: targetId, nonce, url, anonKey, webUrl,
        session: { access_token, refresh_token, token_type, expires_in, expires_at, user },
      }, (result) => {
        clearTimeout(timer);
        const error = rt.lastError;
        const reason = error?.message || result?.error || result?.reason || "no_response";
        // `unknown_message` is returned by an older NORTH extension build
        // which predates the nonce-bound connect protocol. Make the repair
        // actionable instead of exposing an opaque protocol token.
        if (!error && result?.error === "unknown_message") {
          resolve({ ok: false, reason: "extension_outdated" });
          return;
        }
        resolve(error ? { ok: false, reason } : result?.ok ? { ok: true, synced: Boolean(result.synced), syncReason: result.reason || null, version: result.version || null } : { ok: false, reason });
      });
    } catch (error) {
      clearTimeout(timer);
      resolve({ ok: false, reason: String(error?.message || error) });
    }
  });
}
