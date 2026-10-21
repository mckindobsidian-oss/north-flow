/**
 * NORTH extension — turning a blocking reason into the words on the block page
 * (PURE).
 *
 * The block page must never invent a reason. The worker evaluates the shared
 * engine, reads the reason it gives for the rule that actually matched, and
 * passes that *code* through the URL; this module is the only place those codes
 * become sentences, so the page cannot claim "Focus Mode is active" for a rule
 * that was blocked by a schedule.
 *
 * Nothing account-identifying travels in the URL — a domain, a reason code, an
 * optional schedule name the user themselves typed, and a countdown. Never a
 * token, never a user id.
 */

/** Reason codes as they appear in the query string. */
export const REASON_CODES = ["always", "focus", "schedule", "limit"];

/**
 * Map the shared engine's reason string onto a code.
 * The engine speaks `"always"` | `"focus"` | `"schedule:<names>"` | `"temp-unblock"`.
 */
export function encodeReason(reason) {
  const r = String(reason || "");
  if (r === "focus") return "focus";
  if (r === "daily-limit") return "limit";
  if (r.startsWith("schedule:")) return "schedule";
  if (r === "always") return "always";
  // A temporary unblock means the rule is NOT blocking; reaching here means the
  // caller asked about something else. "always" is the honest default: the rule
  // is on the user's list and that is why the request was stopped.
  return "always";
}

/** The schedule names carried by a `schedule:<a>, <b>` reason string. */
export function scheduleNames(reason) {
  const r = String(reason || "");
  if (!r.startsWith("schedule:")) return "";
  return r.slice("schedule:".length).trim();
}

/**
 * The words for the block page.
 *
 * @param {object} p
 * @param {string} p.code        one of REASON_CODES
 * @param {string} p.domain      the host the user tried to open
 * @param {string} [p.names]     schedule name(s), when the reason is a schedule
 * @param {number} [p.minutesLeft]  minutes remaining in a focus session
 * @returns {{ headline: string, detail: string, tone: "focus"|"blocked", badge: string }}
 */
export function describeBlock({ code, domain, names = "", minutesLeft = 0 }) {
  const site = String(domain || "This website");
  switch (code) {
    case "focus": {
      const left = Number(minutesLeft) > 0 ? `${Number(minutesLeft)} minute${Number(minutesLeft) === 1 ? "" : "s"} left` : "in progress";
      return {
        headline: "Focus Mode is running",
        detail: `${site} is blocked while you focus. ${left}.`,
        tone: "focus",
        badge: "Focus Mode",
      };
    }
    case "schedule": {
      const which = names ? `${names} is active right now` : "A schedule is active right now";
      return {
        headline: "A schedule is blocking this website",
        detail: `${which}, and ${site} is on your blocked list.`,
        tone: "blocked",
        badge: names || "Scheduled",
      };
    }
    case "limit":
      return {
        headline: "You have reached your limit for this website",
        detail: `${site} is blocked until its daily allowance resets at midnight UTC.`,
        tone: "blocked",
        badge: "Limit reached",
      };
    case "always":
    default:
      return {
        headline: "This website is blocked by North Flow",
        detail: `${site} is on your blocked list in North.`,
        tone: "blocked",
        badge: "Blocked",
      };
  }
}

/** Parse the block page's own query string (kept here so it can be tested). */
export function parseBlockParams(search) {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const code = REASON_CODES.includes(q.get("r")) ? q.get("r") : "always";
  const minutesLeft = Math.max(0, Math.min(24 * 60, Number(q.get("m")) || 0));
  return {
    domain: String(q.get("d") || ""),
    code,
    names: String(q.get("n") || "").slice(0, 80),
    minutesLeft,
    ruleId: String(q.get("i") || "").slice(0, 80),
  };
}

/** Build the block page URL for a blocked request. Never carries a token. */
export function blockPageUrl(baseUrl, { domain, code, names = "", minutesLeft = 0, ruleId = "" }) {
  const q = new URLSearchParams({ d: domain, r: code });
  if (names) q.set("n", names);
  if (minutesLeft > 0) q.set("m", String(minutesLeft));
  if (ruleId) q.set("i", String(ruleId).slice(0, 80));
  return `${baseUrl}?${q.toString()}`;
}
