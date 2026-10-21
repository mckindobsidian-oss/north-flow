/**
 * NORTH extension — declarativeNetRequest rule planning (PURE).
 *
 * WHY THIS FILE IS SEPARATE
 * Deciding "which browser rules should exist, given these domains" is the one
 * piece of the extension that is genuinely easy to get subtly wrong — a stale
 * rule keeps blocking a site the user removed, a duplicated rule makes
 * `updateDynamicRules` throw, and a naive substring match blocks `notyoutube.com`
 * when they asked for `youtube.com`. Keeping it pure (no `chrome.*`) means the
 * same functions the worker runs are the ones `tests/extension.test.mjs` covers.
 *
 * MATCHING SEMANTICS — deliberately Chrome's, not ours
 * A Chrome `urlFilter` of `||youtube.com^` matches the domain itself and any
 * subdomain on a *label boundary* (the start of the hostname or just after a
 * dot), and the trailing `^` is the separator that follows a domain
 * (`/`, `:`, `?`, end of URL…). So `youtube.com`, `www.youtube.com` and
 * `m.youtube.com` match, while `notyoutube.com`, `youtube-example.com` and
 * `myyoutube.com` do not. `hostMatches` below mirrors exactly that rule so the
 * popup's "is this page blocked?" answer and the browser's enforcement can
 * never disagree.
 *
 * WHY HASHED IDS
 * `updateDynamicRules` is a diff: rules keep their id, so the worker can add
 * the one domain that changed instead of rebuilding the whole list every
 * minute. Ids are derived from the host, so a domain keeps its id for as long
 * as it is blocked. Collisions are resolved by probing (see `assignRuleIds`).
 */

/** Ids below this are reserved (static rules in the manifest use them). */
export const RULE_ID_MIN = 1000;
/** Upper bound is exclusive; keeps us clear of any future static-rule band. */
export const RULE_ID_MAX = 21000;

const SPAN = RULE_ID_MAX - RULE_ID_MIN;

/** Stable, well-spread id for a host. Not cryptographic — just needs to scatter. */
export function ruleIdFor(host) {
  const s = String(host || "");
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return RULE_ID_MIN + ((h >>> 0) % SPAN);
}

/**
 * The `urlFilter` that blocks a host and its subdomains, and nothing else.
 * `||` anchors on a domain boundary (so `notyoutube.com` cannot match) and the
 * trailing `^` is the separator that must follow the domain.
 */
export const filterFor = (host) => `||${host}^`;

/** The resource types worth blocking: the page itself, plus embedded frames. */
export const BLOCKED_RESOURCE_TYPES = ["main_frame", "sub_frame"];

/** Where the browser's own block-rule band starts, so our diff only touches ours. */
export const isOurRuleId = (id) => Number(id) >= RULE_ID_MIN && Number(id) < RULE_ID_MAX;

/**
 * Would Chrome's `||target^` rule match `host`? Mirrors the documented semantics
 * above: the host itself, or a subdomain on a label boundary.
 */
export function hostMatches(target, host) {
  const t = String(target || "").toLowerCase().replace(/\.+$/, "");
  const h = String(host || "").toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  if (!t || !h) return false;
  return h === t || h.endsWith(`.${t}`);
}

/**
 * Would this host be blocked right now, and why? `verdict` is the shared
 * engine's `evaluateBlocking()` result, so the popup never re-derives the
 * rules — it only asks which of the already-decided rules covers this page.
 */
export function matchForHost(verdict, host) {
  const rules = verdict?.websites || [];
  for (const target of rules) {
    if (hostMatches(target, host)) return target;
  }
  return null;
}

/**
 * Assign every host an id, resolving the (astronomically unlikely) case where
 * two domains hash to the same slot. Deterministic for a given set, so a second
 * call produces the same ids and the diff stays empty.
 */
export function assignRuleIds(hosts) {
  const sorted = [...new Set(hosts.map((h) => String(h || "")).filter(Boolean))].sort();
  const byId = new Map();
  const out = new Map();
  for (const host of sorted) {
    let id = ruleIdFor(host);
    let guard = 0;
    while (byId.has(id) && byId.get(id) !== host && guard++ < SPAN) {
      id = id + 1 >= RULE_ID_MAX ? RULE_ID_MIN : id + 1;
    }
    byId.set(id, host);
    out.set(host, id);
  }
  return out;
}

/** The dynamic rule that blocks one host. */
export function buildBlockRule(host, id = ruleIdFor(host)) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: filterFor(host), resourceTypes: [...BLOCKED_RESOURCE_TYPES] },
  };
}

/**
 * Reconcile "what should be blocked" against "what the browser currently has".
 *
 * Only our own id band is considered, so rules another extension wrote are
 * never touched. The result is a minimal diff: a domain that is already blocked
 * keeps its rule (no remove/add churn), a removed domain's rule is dropped, and
 * a newly added domain gets one.
 *
 * @param {string[]} hosts        desired hosts (duplicates are collapsed)
 * @param {number[]} existingIds  ids of dynamic rules currently in our band
 */
export function planRules(hosts, existingIds = []) {
  const ids = assignRuleIds(hosts);
  const wanted = new Map([...ids.entries()].map(([host, id]) => [id, host]));
  const have = new Set(existingIds.filter(isOurRuleId));

  const addRules = [];
  for (const [id, host] of wanted) {
    if (!have.has(id)) addRules.push(buildBlockRule(host, id));
  }
  // A rule is stale when its id is not the id of any desired host. Because ids
  // are host-derived, a domain that is simply *toggled off* also lands here.
  const removeRuleIds = [...have].filter((id) => !wanted.has(id));

  return { addRules, removeRuleIds, ids, unchanged: !addRules.length && !removeRuleIds.length };
}
