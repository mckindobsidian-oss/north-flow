/**
 * NORTH — canonical blocking engine (shared by every client).
 *
 * WHY THIS FILE EXISTS
 * Website blocking, app blocking, focus sessions and schedules are one feature
 * seen from four clients. If each client re-implemented "is this blocked right
 * now?", the four answers would drift apart and the product would feel
 * inconsistent — the exact failure this module prevents. Every client imports
 * this file (see scripts/sync-shared.mjs) and only adds what it alone can do:
 *
 *   web        → configure rules, show configured-vs-enforced status
 *   extension  → enforce website rules via declarativeNetRequest
 *   desktop    → enforce app rules against the OS process list (Rust)
 *   mobile     → configure + notify; enforcement is OS-limited, stated plainly
 *
 * This module is PURE: no DOM, no chrome.*, no React, no storage. Give it the
 * state and a timestamp, get back exactly what should be blocked. That makes
 * it unit-testable once for all clients (tests/blocking.test.mjs).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * STATE SHAPE (persisted per user; mirrored by supabase/schema.sql)
 * ─────────────────────────────────────────────────────────────────────────
 * {
 *   version: 2,
 *   rules: [
 *     { id, kind: "website" | "app", target, label, enabled,
 *       when: "always" | "focus" | "scheduled", scheduleIds: string[], createdAt }
 *   ], usageLimits: [{ id, kind: "website"|"app", target, mode: "daily"|"session", dailyLimitMinutes?, name, enabled }],
 *   ],
 *   schedules: [
 *     { id, name, days: number[], start: "HH:MM", end: "HH:MM", enabled }
 *   ],
 *   settings: { blockDuringFocus, tempUnblockMinutes, allowTemporaryUnblock },
 *   unblocks: { [ruleId]: epochMs },  // temporary unblock expiry
 *   focus: { startedAt, minutes, endAt } | null
 * }
 *
 * `days` uses JS convention: 0 = Sunday … 6 = Saturday (Date#getDay).
 */

export const BLOCKING_VERSION = 2;

export const RULE_KINDS = ["website", "app"];

/** When a rule applies. */
export const RULE_WHEN = ["always", "focus", "scheduled"];

export const RULE_WHEN_LABEL = {
  always: "Always",
  focus: "During focus",
  scheduled: "Scheduled",
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];

/**
 * What each client can genuinely do. This is DATA on purpose: the web app
 * renders "configured" vs "enforced" from this table instead of hard-coding a
 * marketing claim, and no client can quietly pretend it enforces something the
 * platform does not let it enforce.
 */
export const CLIENT_CAPABILITIES = {
  web: {
    id: "web",
    label: "Web app",
    configure: true,
    enforceWebsites: false,
    enforceApps: false,
    note: "A web page cannot block what the browser or the OS does. It configures rules for the clients that can.",
  },
  extension: {
    id: "extension",
    label: "Browser extension",
    configure: true,
    enforceWebsites: true,
    enforceApps: false,
    note: "Blocks websites for real (declarativeNetRequest). Cannot touch OS applications.",
  },
  desktop: {
    id: "desktop",
    label: "Desktop app",
    configure: true,
    enforceWebsites: false,
    enforceApps: true,
    note: "Ends blocked applications while the rule is active (process-level). Cannot block websites in a browser it does not own.",
  },
  mobile: {
    id: "mobile",
    label: "Mobile app",
    configure: true,
    enforceWebsites: false,
    enforceApps: false,
    note: "iOS Screen Time / Android UsageStats can enforce app limits only through a native, OS-granted entitlement — not shipped yet.",
  },
};

// ── ids ───────────────────────────────────────────────────────────────────
let seq = 0;
export const newId = (prefix = "r") =>
  `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;

// ── normalization ─────────────────────────────────────────────────────────
/**
 * Turn anything a human types into a bare hostname: strips scheme, path,
 * query, port, `www.`, and trailing dots. Returns "" when the input cannot be
 * a host (so callers can validate instead of storing junk that never matches).
 */
export function normalizeHost(input) {
  if (typeof input !== "string") return "";
  let s = input.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme://
  s = s.split("/")[0];                          // path
  s = s.split("?")[0].split("#")[0];
  s = s.split("@").pop();                       // user:pass@
  s = s.replace(/:\d+$/, "");                   // port
  s = s.replace(/^www\./, "");
  s = s.replace(/\.+$/, "");
  if (s === "localhost") return s;
  // A real host has at least one dot and no whitespace.
  if (!s.includes(".") || /\s/.test(s)) return "";
  if (!/^[a-z0-9.-]+$/.test(s)) return "";
  if (s.startsWith(".") || s.includes("..")) return "";
  return s;
}

/** App names are matched case-insensitively but displayed as typed. */
export function normalizeApp(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\s+/g, " ");
}

export const appKey = (name) => normalizeApp(name).toLowerCase();

// ── defaults ──────────────────────────────────────────────────────────────
export function defaultSettings() {
  return {
    /** Every rule with when:"focus" applies while a focus session runs. */
    blockDuringFocus: true,
    allowTemporaryUnblock: true,
    tempUnblockMinutes: 5,
  };
}

export function defaultBlocking() {
  return {
    version: BLOCKING_VERSION,
    rules: [],
    usageLimits: [],
    schedules: [],
    settings: defaultSettings(),
    unblocks: {},
    focus: null,
  };
}

/**
 * Make any (possibly partial, possibly legacy) state safe to evaluate. Clients
 * store JSON they wrote in older versions, so this is the one place that
 * upgrades shapes instead of every call site guarding property access.
 */
export function normalizeState(state) {
  const base = state && typeof state === "object" ? state : {};
  const settings = { ...defaultSettings(), ...(base.settings || {}) };
  const rules = (Array.isArray(base.rules) ? base.rules : [])
    .map((r) => ({
      id: r?.id || newId(),
      kind: RULE_KINDS.includes(r?.kind) ? r.kind : "website",
      target: r?.kind === "app" ? normalizeApp(r?.target) : normalizeHost(r?.target),
      label: typeof r?.label === "string" && r.label ? r.label : r?.target || "",
      enabled: r?.enabled !== false,
      when: RULE_WHEN.includes(r?.when) ? r.when : "always",
      scheduleIds: Array.isArray(r?.scheduleIds) ? r.scheduleIds.filter(Boolean) : [],
      createdAt: typeof r?.createdAt === "number" ? r.createdAt : Date.now(),
    }))
    .filter((r) => r.target);
  const schedules = (Array.isArray(base.schedules) ? base.schedules : [])
    .map((s) => ({
      id: s?.id || newId("s"),
      name: typeof s?.name === "string" && s.name ? s.name : "Schedule",
      days: (Array.isArray(s?.days) ? s.days : WORKDAYS)
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b),
      start: normalizeTime(s?.start, "09:00"),
      end: normalizeTime(s?.end, "17:00"),
      enabled: s?.enabled !== false,
    }))
    .filter((s) => s.days.length > 0);
  const usageLimits = (Array.isArray(base.usageLimits) ? base.usageLimits : [])
    .map((limit) => {
      const minutes = Number(limit?.dailyLimitMinutes);
      const kind = limit?.kind === "app" ? "app" : "website";
      const target = kind === "app" ? normalizeApp(limit?.target) : normalizeHost(limit?.target);
      const mode = limit?.mode === "session" ? "session" : "daily";
      if (!target || ((mode === "daily" || kind === "app") && (!Number.isInteger(minutes) || minutes < 1))) return null;
      return {
        id: limit?.id || newId("l"), kind, target, mode,
        ...(mode === "daily" || kind === "app" ? { dailyLimitMinutes: Math.min(mode === "session" ? 240 : 1440, minutes) } : {}),
        name: typeof limit?.name === "string" ? limit.name.trim().slice(0, 60) : "",
        enabled: limit?.enabled !== false,
      };
    })
    .filter(Boolean);
  const unblocks = {};
  for (const [k, v] of Object.entries(base.unblocks || {})) {
    if (typeof v === "number") unblocks[k] = v;
  }
  const rawFocus = base.focus;
  const focus =
    rawFocus && typeof rawFocus === "object" && Number(rawFocus.endAt) > 0
      ? {
          startedAt: Number(rawFocus.startedAt) || 0,
          minutes: Number(rawFocus.minutes) || 0,
          endAt: Number(rawFocus.endAt),
        }
      : null;
  return { version: BLOCKING_VERSION, rules, schedules, usageLimits, settings, unblocks, focus };
}

/**
 * "9:5" → "09:05", " 17 : 00 " → "17:00"; anything unusable falls back to the
 * default. Deliberately forgiving: these values come from typed input on four
 * different clients, and a half-typed time should never block a whole save.
 */
export function normalizeTime(value, fallback) {
  if (typeof value !== "string") return fallback;
  const m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(value.trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export const minutesOf = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

// ── schedules ─────────────────────────────────────────────────────────────
/**
 * Is a schedule running at `now`? Windows may cross midnight ("22:00"→"06:00"),
 * in which case the *start* day decides the day the window belongs to — a
 * Friday 22:00–06:00 window therefore still blocks at 02:00 on Saturday.
 * A zero-length window (start === end) is treated as never active rather than
 * always active, so a typo can't block someone 24/7.
 */
export function isScheduleActive(schedule, now = Date.now()) {
  if (!schedule || schedule.enabled === false) return false;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (!days.length) return false;
  const start = minutesOf(schedule.start);
  const end = minutesOf(schedule.end);
  if (start === end) return false;

  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  if (start < end) {
    return days.includes(d.getDay()) && cur >= start && cur < end;
  }
  // Cross-midnight: before `end` belongs to yesterday's start day.
  if (cur < end) {
    const prev = new Date(d.getTime() - 86400000).getDay();
    return days.includes(prev);
  }
  return days.includes(d.getDay()) && cur >= start;
}

/** Every enabled schedule that is running right now. */
export function activeSchedules(state, now = Date.now()) {
  const s = normalizeState(state);
  return s.schedules.filter((sc) => isScheduleActive(sc, now));
}

// ── focus sessions ────────────────────────────────────────────────────────
/** A focus session is { startedAt, minutes, endAt } — or null when idle. */
export function focusActive(focus, now = Date.now()) {
  if (!focus) return false;
  const end = Number(focus.endAt) || 0;
  return end > now;
}

export function focusRemainingMs(focus, now = Date.now()) {
  if (!focusActive(focus, now)) return 0;
  return Math.max(0, Number(focus.endAt) - now);
}

export function startFocus(minutes, now = Date.now()) {
  const m = Math.max(1, Math.round(Number(minutes) || 25));
  return { startedAt: now, minutes: m, endAt: now + m * 60000 };
}

// ── temporary unblock ─────────────────────────────────────────────────────
export function unblockUntil(state, ruleId, minutes, now = Date.now()) {
  const s = normalizeState(state);
  const mins = Math.max(1, Math.round(Number(minutes) || s.settings.tempUnblockMinutes));
  return { ...s, unblocks: { ...s.unblocks, [ruleId]: now + mins * 60000 } };
}

export function isTemporarilyUnblocked(state, ruleId, now = Date.now()) {
  const until = state?.unblocks?.[ruleId];
  return typeof until === "number" && until > now;
}

// ── THE decision ──────────────────────────────────────────────────────────
/**
 * Work out what NORTH should block at `now`, and why. Every client calls this
 * and then enforces only the half it is allowed to enforce:
 *
 *   const v = evaluateBlocking(state, Date.now());
 *   v.websites   // hosts the extension must block
 *   v.apps       // app names the desktop app must end
 *   v.reasons    // ruleId → "always" | "focus" | "schedule:<name>" | "temp-unblock"
 *
 * A temporary unblock wins over every other reason, on every client, because
 * it is an explicit user action with an expiry — after the expiry the same
 * rule re-applies with no extra bookkeeping.
 */
export function evaluateBlocking(state, now = Date.now(), usageSecondsByHost = {}, usageSecondsByApp = {}) {
  const s = normalizeState(state);
  const running = activeSchedules(s, now);
  const focusOn = s.settings.blockDuringFocus && focusActive(s.focus, now);

  const websites = [];
  const apps = [];
  const reasons = {};

  for (const rule of s.rules) {
    if (!rule.enabled) continue;

    let why = null;
    let hitIds = [];
    if (rule.when === "always") why = "always";
    else if (rule.when === "focus") why = focusOn ? "focus" : null;
    else if (rule.when === "scheduled") {
      const scoped = rule.scheduleIds.length
        ? running.filter((sc) => rule.scheduleIds.includes(sc.id))
        : running;
      if (scoped.length) {
        why = `schedule:${scoped.map((h) => h.name).join(", ")}`;
        hitIds = scoped.map((h) => h.id);
      }
    }
    if (!why) continue;

    if (isTemporarilyUnblocked(s, rule.id, now)) {
      reasons[rule.id] = {
        reason: "temp-unblock",
        until: s.unblocks[rule.id],
        target: rule.target,
        kind: rule.kind,
      };
      continue;
    }

    reasons[rule.id] = { reason: why, target: rule.target, kind: rule.kind, scheduleIds: hitIds };
    if (rule.kind === "website") websites.push(rule.target);
    else apps.push(rule.target);
  }

  for (const limit of s.usageLimits) {
    if (!limit.enabled || limit.mode === "session") continue; // session allowances are tab-scoped and enforced by the extension.
    if (limit.kind === "app") {
      const used = Object.entries(usageSecondsByApp || {}).reduce((total, [name, seconds]) =>
        total + (appKey(name) === appKey(limit.target) ? Math.max(0, Number(seconds) || 0) : 0), 0);
      if (used < limit.dailyLimitMinutes * 60) continue;
      if (isTemporarilyUnblocked(s, limit.id, now)) {
        reasons[limit.id] = { reason: "temp-unblock", until: s.unblocks[limit.id], target: limit.target, kind: "app" };
        continue;
      }
      reasons[limit.id] = { reason: "daily-limit", target: limit.target, kind: "app" };
      apps.push(limit.target);
      continue;
    }
    const used = Object.entries(usageSecondsByHost || {}).reduce((total, [host, seconds]) => {
      const domain = normalizeHost(host);
      return total + (domain && (domain === limit.target || domain.endsWith(`.${limit.target}`))
        ? Math.max(0, Number(seconds) || 0) : 0);
    }, 0);
    if (used < limit.dailyLimitMinutes * 60) continue;
    if (isTemporarilyUnblocked(s, limit.id, now)) {
      reasons[limit.id] = { reason: "temp-unblock", until: s.unblocks[limit.id], target: limit.target, kind: "website" };
      continue;
    }
    reasons[limit.id] = { reason: "daily-limit", target: limit.target, kind: "website" };
    websites.push(limit.target);
  }

  return {
    active: websites.length > 0 || apps.length > 0,
    websites: [...new Set(websites)],
    apps: [...new Set(apps.map(appKey))],
    // Display names for apps (hosts are already canonical); matching against
    // the OS process list is case-insensitive, so `apps` stays lowercase.
    appLabels: [...new Set(apps)],
    reasons,
    focus: {
      active: focusActive(s.focus, now),
      endsAt: s.focus ? Number(s.focus.endAt) : 0,
      minutesLeft: Math.ceil(focusRemainingMs(s.focus, now) / 60000),
    },
    schedules: running.map((sc) => ({ id: sc.id, name: sc.name, end: sc.end })),
  };
}

/** Convenience: just the host list the extension needs for DNR rules. */
export const blockedHosts = (state, now = Date.now()) => evaluateBlocking(state, now).websites;

// ── rule/schedule editing helpers (used by every client's UI) ─────────────
export function upsertRule(state, rule) {
  const s = normalizeState(state);
  const next = normalizeState({ ...s, rules: [...s.rules.filter((r) => r.id !== rule.id), rule] });
  return next;
}

export function removeRule(state, ruleId) {
  const s = normalizeState(state);
  const unblocks = { ...s.unblocks };
  delete unblocks[ruleId];
  return { ...s, rules: s.rules.filter((r) => r.id !== ruleId), unblocks };
}

export function upsertUsageLimit(state, limit) {
  const s = normalizeState(state);
  const kind = limit?.kind === "app" ? "app" : "website";
  const target = kind === "app" ? normalizeApp(limit?.target) : normalizeHost(limit?.target);
  const mode = limit?.mode === "session" ? "session" : "daily";
  const minutes = Number(limit?.dailyLimitMinutes);
  if (!target || ((mode === "daily" || kind === "app") && (!Number.isInteger(minutes) || minutes < 1))) return s;
  const next = {
    id: limit.id || newId("l"), kind, target, mode,
    ...(mode === "daily" || kind === "app" ? { dailyLimitMinutes: Math.min(mode === "session" ? 240 : 1440, minutes) } : {}),
    name: typeof limit.name === "string" ? limit.name.trim().slice(0, 60) : "",
    enabled: limit.enabled !== false,
  };
  return normalizeState({ ...s, usageLimits: [...s.usageLimits.filter((item) => item.id !== next.id), next] });
}

export function removeUsageLimit(state, limitId) {
  const s = normalizeState(state);
  const unblocks = { ...s.unblocks };
  delete unblocks[limitId];
  return { ...s, usageLimits: s.usageLimits.filter((limit) => limit.id !== limitId), unblocks };
}

export function setRuleEnabled(state, ruleId, enabled) {
  const s = normalizeState(state);
  return { ...s, rules: s.rules.map((r) => (r.id === ruleId ? { ...r, enabled: !!enabled } : r)) };
}

export function upsertSchedule(state, schedule) {
  const s = normalizeState(state);
  return normalizeState({ ...s, schedules: [...s.schedules.filter((x) => x.id !== schedule.id), schedule] });
}

export function removeSchedule(state, scheduleId) {
  const s = normalizeState(state);
  return normalizeState({
    ...s,
    schedules: s.schedules.filter((x) => x.id !== scheduleId),
    // A rule pointing at a deleted schedule would silently stop blocking, so
    // drop the dangling references (empty list = "all enabled schedules").
    rules: s.rules.map((r) => ({ ...r, scheduleIds: r.scheduleIds.filter((id) => id !== scheduleId) })),
  });
}

export function newRule({ kind = "website", target, when = "always", scheduleIds = [], label } = {}) {
  const t = kind === "app" ? normalizeApp(target) : normalizeHost(target);
  return {
    id: newId(kind === "app" ? "a" : "w"),
    kind,
    target: t,
    label: label || t,
    enabled: true,
    when: RULE_WHEN.includes(when) ? when : "always",
    scheduleIds: [...scheduleIds],
    createdAt: Date.now(),
  };
}

export function newSchedule({ name = "Schedule", days = WORKDAYS, start = "09:00", end = "17:00", enabled = true } = {}) {
  return { id: newId("s"), name, days: [...days], start: normalizeTime(start, "09:00"), end: normalizeTime(end, "17:00"), enabled };
}

/**
 * Import rules a client already had, so upgrading never loses a user's setup:
 *  - the extension's `blockedSites: string[]`
 *  - the web tracker's `apps: [{ name, blocked }]`
 *  - the desktop client's `blockedApps: string[]`
 * Existing "blocked" flags become `when: "always"` rules (what they meant
 * before schedules existed), and duplicates are collapsed.
 */
export function migrateLegacy({ blockedSites = [], trackedApps = [], blockedApps = [], settings } = {}) {
  const state = defaultBlocking();
  if (settings) state.settings = { ...state.settings, ...settings };
  const seen = new Set();
  const push = (rule) => {
    if (!rule.target) return;
    const key = `${rule.kind}:${rule.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    state.rules.push(rule);
  };
  for (const host of blockedSites) push(newRule({ kind: "website", target: host }));
  for (const app of trackedApps) if (app?.blocked) push(newRule({ kind: "app", target: app.name }));
  for (const app of blockedApps) push(newRule({ kind: "app", target: app }));
  return state;
}

// ── status text shared by every client's UI ───────────────────────────────
/** One-line, honest status: what is blocked right now and what happens next. */
export function describeBlocking(state, now = Date.now(), usageSecondsByHost = {}) {
  const s = normalizeState(state);
  const v = evaluateBlocking(s, now, usageSecondsByHost);
  const configured = s.rules.filter((r) => r.enabled).length + s.usageLimits.filter((limit) => limit.enabled).length;

  if (v.active) {
    const bits = [];
    if (v.websites.length) bits.push(`${v.websites.length} site${v.websites.length === 1 ? "" : "s"}`);
    if (v.apps.length) bits.push(`${v.apps.length} app${v.apps.length === 1 ? "" : "s"}`);
    const why = Object.values(v.reasons).some((reason) => reason.reason === "daily-limit")
      ? "daily time limits"
      : v.focus.active ? "focus session" : v.schedules.length ? v.schedules.map((x) => x.name).join(", ") : "always-on rules";
    return { active: true, headline: `Blocking ${bits.join(" and ")}`, detail: `Because of ${why}` };
  }
  if (v.focus.active) {
    return { active: false, headline: "Focus session running", detail: "No rules apply during focus yet" };
  }
  const next = nextBoundary(s, now);
  return {
    active: false,
    headline: configured ? "Nothing blocked right now" : "Nothing to block yet",
    detail: s.usageLimits.length
      ? "Daily limits are enforced by the browser extension"
      : next ? `Next schedule starts ${next}` : configured ? "Your rules are waiting for their window" : "Add a site or app to start",
  };
}

const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The next instant at which this state's verdict could change (a schedule edge,
 * or the end of a temporary unblock). Looks 8 days ahead so weekly schedules are
 * always covered. Returns epoch ms, or null when nothing is scheduled at all.
 */
export function nextTransitionAt(state, now = Date.now()) {
  const s = normalizeState(state);
  const focusEnd = s.focus ? Number(s.focus.endAt) : 0;
  let best = focusEnd > now ? focusEnd : null;
  const consider = (ts) => {
    if (ts > now && (best === null || ts < best)) best = ts;
  };
  for (const sc of s.schedules) {
    if (!sc.enabled || sc.days.length === 0) continue;
    const [sh, sm] = sc.start.split(":").map(Number);
    const [eh, em] = sc.end.split(":").map(Number);
    for (let d = 0; d <= 7; d++) {
      const day = new Date(now + d * 86400000);
      if (!sc.days.includes(day.getDay())) continue;
      consider(new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm, 0, 0).getTime());
      consider(new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em, 0, 0).getTime());
    }
  }
  for (const until of Object.values(s.unblocks)) consider(until);
  return best;
}

/**
 * When the current verdict would next change — used for a truthful "next …"
 * line in the UI. Returns a clock time string, or null when nothing is ahead.
 */
export function nextBoundary(state, now = Date.now()) {
  const ts = nextTransitionAt(state, now);
  return ts === null ? null : fmtClock(ts);
}

/**
 * Milliseconds until the verdict could change — what a background worker
 * should set its next alarm for. Capped at 1 hour so a worker never sleeps
 * through a longer change, and floored at 1s so it can't spin.
 */
export function msUntilBoundary(state, now = Date.now()) {
  const ts = nextTransitionAt(state, now);
  if (ts === null) return null;
  return Math.max(1000, Math.min(ts - now, 60 * 60 * 1000));
}

/** Group rules for a UI: enabled/disabled, by kind, with their schedule names. */
export function rulesByKind(state) {
  const s = normalizeState(state);
  const decorate = (r) => ({
    ...r,
    whenLabel:
      r.when === "scheduled"
        ? r.scheduleIds.length
          ? `Scheduled: ${s.schedules.filter((x) => r.scheduleIds.includes(x.id)).map((x) => x.name).join(", ") || "deleted schedule"}`
          : "Scheduled: any schedule"
        : RULE_WHEN_LABEL[r.when],
  });
  return {
    websites: s.rules.filter((r) => r.kind === "website").map(decorate),
    apps: s.rules.filter((r) => r.kind === "app").map(decorate),
  };
}
