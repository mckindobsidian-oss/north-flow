/**
 * NORTH extension — the website → extension channel (PURE policy).
 *
 * WHY THERE IS A POLICY FILE AT ALL
 * A content script or an `externally_connectable` handler is a hole in the
 * extension's perimeter, and the only thing standing between "the North tab
 * asked for its own status/usage" and "some page turned blocking off" is a decision about
 * *what a web page is allowed to say*. That decision lives here, in one small
 * pure function, so it can be tested and read in a few seconds.
 *
 * WHAT A WEB PAGE MAY DO
 * Normal messages only request status, usage or a re-sync. A separate connect
 * action accepts the signed-in account session only with a short-lived nonce
 * created by an explicit extension click. Pages cannot alter rules directly.
 */

/**
 * The origins the extension will listen to. Deliberately exact origins
 * (scheme + host + port), never `<all_urls>` and never a bare `*` — a wildcard
 * here would hand every page on the web the same channel as North.
 *
 * `externally_connectable.matches` in manifest.json must list the same hosts;
 * this list is the runtime second check, so a manifest edit alone can never
 * silently widen what the code accepts.
 */
export const NORTH_WEB_ORIGINS = [
  "http://localhost:5173", // vite dev (the real app)
  "http://localhost:5174", // vite preview harness (port pinned by config)
  "https://north.vercel.app", // deployed origin — see apps/extension/README.md
];

/**
 * The complete set of messages a North page may send.
 *
 * `north-sync` / `north-focus` exist so a rule the user just edited, or a Focus
 * Mode session they just started, takes effect immediately instead of at the
 * next background refresh. `north-ping` checks installation; `north-usage`
 * returns daily domain/time totals only to NORTH's own origin.
 */
export const EXTERNAL_MESSAGES = {
  "north-ping": "status",
  "north-usage": "usage",
  "north-sync": "sync",
  "north-focus": "sync",
  "north-connect": "connect",
};

/** Is this origin one of North's own? */
export function isTrustedOrigin(origin) {
  const o = String(origin || "").replace(/\/+$/, "");
  return NORTH_WEB_ORIGINS.includes(o);
}

/**
 * Resolve an external (web-page) message into an action the worker may take.
 * Returns `{ ok: false, error }` for anything unrecognised — never a silent
 * success, so the web app can tell "the extension ignored me" from "the
 * extension isn't there".
 */
export function externalAction(message, origin) {
  if (!isTrustedOrigin(origin)) return { ok: false, error: "untrusted_origin" };
  const type = String(message?.type || "");
  // `Object.hasOwn`, NOT a truthiness test on `EXTERNAL_MESSAGES[type]`: object
  // literals inherit from Object.prototype, so a message typed "__proto__" or
  // "constructor" would otherwise look like a known message and hand a
  // prototype object back to the caller.
  if (!Object.hasOwn(EXTERNAL_MESSAGES, type)) return { ok: false, error: "unknown_message" };
  return { ok: true, action: EXTERNAL_MESSAGES[type] };
}
