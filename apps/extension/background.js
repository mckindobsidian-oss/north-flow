/**
 * NORTH extension — background service worker (Manifest V3, ES module).
 *
 * WHAT IS REAL HERE
 *  - Website blocking: chrome.declarativeNetRequest dynamic rules. The worker
 *    does not decide *what* to block — it asks the shared engine
 *    (./lib/blocking.js, generated from packages/shared-types) and applies the
 *    answer. Focus sessions, schedules and temporary unblocks therefore all
 *    work through one code path, identical to the web and desktop clients.
 *  - Focus sessions: wall-clock end time + alarms, so a session survives the
 *    service worker being suspended (a naive setTimeout does not).
 *  - Scheduled blocking: the engine's verdict changes at schedule boundaries,
 *    so we set an alarm for the next boundary (msUntilBoundary) and re-evaluate
 *    then — plus a once-a-minute safety re-sync.
 *  - Temporary unblock: an explicit, expiring pause that the engine honours
 *    until it lapses, after which the same rule re-applies by itself.
 *  - Usage tracking: time on the active tab attributed to its domain, bucketed
 *    per day in chrome.storage.local. No paths, no titles, no page content.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *  - OS application blocking: a browser extension cannot see or touch other
 *    processes. That is the desktop client's job (see apps/desktop).
 *  - Real account auth: Supabase's OAuth flow cannot run inside an MV3 worker
 *    without a web-redirect + chrome.identity handshake. Until that lands, the
 *    extension stores which NORTH account it is linked to and everything stays
 *    on this device — the UI says exactly that rather than implying sync.
 */

import {
  normalizeState,
  normalizeHost,
  newRule,
  newSchedule,
  evaluateBlocking,
  describeBlocking,
  rulesByKind,
  upsertRule,
  removeRule,
  setRuleEnabled,
  upsertSchedule,
  removeSchedule,
  unblockUntil,
  startFocus,
  focusActive,
  migrateLegacy,
  msUntilBoundary,
} from "./lib/blocking.js";

const KEY = {
  /** v2 blocking state (rules/schedules/settings/unblocks/focus). */
  state: "northBlocking",
  /** Linked NORTH account name — identity only; data stays local for now. */
  account: "northAccount",
  /** { "YYYY-MM-DD": { "domain": seconds } } — untouched by the v2 upgrade. */
  usage: "usage",
  /** Legacy keys, read once during migration. */
  legacyBlocked: "blockedSites",
  legacyFocus: "focus",
  /** Websites currently applied to DNR, so we can skip redundant updates. */
  applied: "appliedHosts",
};

const ALARMS = { focusEnd: "focus-end", usageFlush: "usage-flush", blockSync: "block-sync" };
const SYNC_FLOOR_MS = 60 * 1000; // never wait longer than a minute to re-check

// ── state ─────────────────────────────────────────────────────────────────
async function loadState() {
  const raw = await chrome.storage.local.get([
    KEY.state,
    KEY.account,
    KEY.legacyBlocked,
    KEY.legacyFocus,
  ]);
  let state = raw[KEY.state] ? normalizeState(raw[KEY.state]) : null;

  // One-time migration of the pre-v2 shape: the old flat `blockedSites` list
  // (and any focus session interrupted by an update) become engine state.
  if (!state) {
    state = migrateLegacy({ blockedSites: raw[KEY.legacyBlocked] || [] });
    if (raw[KEY.legacyFocus]?.endAt > Date.now()) state.focus = raw[KEY.legacyFocus];
    await chrome.storage.local.set({ [KEY.state]: state });
    await chrome.storage.local.remove([KEY.legacyBlocked, KEY.legacyFocus]);
  }
  return state;
}

const saveState = (state) => chrome.storage.local.set({ [KEY.state]: normalizeState(state) });

// ── enforcement ───────────────────────────────────────────────────────────
let syncing = null;

/**
 * The single place the extension decides what to enforce: ask the shared
 * engine, apply the website half to DNR, refresh the badge, and set the alarm
 * for the next moment the answer could change.
 */
async function syncRules(reason = "manual") {
  if (syncing) return syncing; // collapse concurrent callers into one pass
  syncing = (async () => {
    try {
      const state = await loadState();
      const now = Date.now();
      const verdict = evaluateBlocking(state, now);
      await applyBlockRules(verdict.websites);

      // Badge: how many domains are blocked right now (empty when none).
      const n = verdict.websites.length;
      await chrome.action.setBadgeText({ text: n ? String(n) : "" }).catch(() => {});
      await chrome.action
        .setBadgeBackgroundColor({ color: verdict.focus.active ? "#30D158" : "#FF3B30" })
        .catch(() => {});

      // Wake up exactly when this verdict can change.
      const ms = msUntilBoundary(state, now) ?? SYNC_FLOOR_MS;
      await chrome.alarms.clear(ALARMS.blockSync);
      chrome.alarms.create(ALARMS.blockSync, { when: now + Math.max(1000, ms) });

      if (reason !== "tick") {
        console.debug(
          `[north] sync (${reason}): ${n} site(s), ${verdict.apps.length} app rule(s), ` +
            `focus=${verdict.focus.active} schedules=${verdict.schedules.length}`
        );
      }
      return verdict;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// ── DNR rule application ──────────────────────────────────────────────────
const ruleIdFor = (host) => {
  let h = 1;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return (h % 20000) + 1000; // dynamic rule IDs must be >= 1; keep a safe band
};

async function applyBlockRules(hosts) {
  const want = [...new Set(hosts)].sort();
  const { [KEY.applied]: have = null } = await chrome.storage.local.get(KEY.applied);
  // Skip the IPC when nothing changed — this runs up to once a minute.
  if (have && have.length === want.length && have.every((h, i) => h === want[i])) return;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const mine = existing.filter((r) => r.id >= 1000 && r.id < 21000);
  const wantedIds = new Set(want.map(ruleIdFor));
  const toRemove = mine.map((r) => r.id).filter((id) => !wantedIds.has(id));
  const current = new Set(mine.map((r) => r.id));
  const toAdd = want
    .filter((host) => !current.has(ruleIdFor(host)))
    .map((host) => ({
      id: ruleIdFor(host),
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: `||${host}^`,
        resourceTypes: ["main_frame", "sub_frame"],
      },
    }));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove, addRules: toAdd });
  await chrome.storage.local.set({ [KEY.applied]: want });
}

// ── focus sessions ────────────────────────────────────────────────────────
async function startFocusSession(minutes) {
  const state = await loadState();
  const focus = startFocus(minutes, Date.now());
  await saveState({ ...state, focus });
  chrome.alarms.create(ALARMS.focusEnd, { when: focus.endAt });
  await syncRules("focus-start");
  try {
    await chrome.notifications.create("focus-started", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: "Focus session started",
      message: `${focus.minutes} minutes. Your rules are being enforced.`,
    });
  } catch { /* icon not bundled yet — the session itself is unaffected */ }
  return focus;
}

async function endFocusSession() {
  const state = await loadState();
  await saveState({ ...state, focus: null });
  chrome.alarms.clear(ALARMS.focusEnd);
  await syncRules("focus-end");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARMS.focusEnd: {
      const state = await loadState();
      if (!focusActive(state.focus, Date.now())) {
        await saveState({ ...state, focus: null });
      }
      await syncRules("focus-end");
      try {
        await chrome.notifications.create("focus-done", {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon128.png"),
          title: "Focus session complete 🎉",
          message: "Great work — take a break.",
        });
      } catch { /* same as above */ }
      break;
    }
    case ALARMS.blockSync:
      await syncRules("boundary");
      break;
    case ALARMS.usageFlush:
      bumpUsage();
      // Security net: if a boundary alarm was missed (asleep laptop, update),
      // the verdict is still re-checked within a minute.
      await syncRules("tick");
      break;
  }
});

chrome.runtime.onStartup.addListener(() => { syncRules("startup"); });
chrome.runtime.onInstalled.addListener(async (details) => {
  await loadState(); // triggers the one-time migration
  if (details.reason === "install") {
    // A brand-new install starts with sensible rules the user can edit — not
    // a silent block list. They appear in the popup immediately.
    const state = await loadState();
    if (state.rules.length === 0) {
      await saveState({
        ...state,
        rules: ["youtube.com", "instagram.com", "reddit.com"].map((host) =>
          newRule({ kind: "website", target: host, when: "always" })
        ),
      });
    }
  }
  await syncRules("install");
});

// ── usage tracking (per-domain seconds per day) ───────────────────────────
const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};

let active = { tabId: null, host: null, since: 0 };

function bumpUsage() {
  const s = active.host && active.since ? Math.floor((Date.now() - active.since) / 1000) : 0;
  active.since = Date.now();
  if (!s || !active.host) return;
  chrome.storage.local.get(KEY.usage).then(({ usage = {} }) => {
    const date = new Date().toISOString().slice(0, 10);
    const day = usage[date] || (usage[date] = {});
    day[active.host] = (day[active.host] || 0) + s;
    chrome.storage.local.set({ [KEY.usage]: usage });
  });
}

async function setActive(tabId, url) {
  bumpUsage();
  const host = hostOf(url);
  active = { tabId, host, since: host ? Date.now() : 0 };
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const t = await chrome.tabs.get(tabId);
    await setActive(tabId, t.pendingUrl || t.url);
  } catch { /* tab closed between events */ }
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.active) setActive(tabId, info.url);
  if (info.status === "complete" && tab.active) setActive(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (active.tabId === tabId) active = { tabId, host: null, since: 0 };
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) { bumpUsage(); active = { tabId: null, host: null, since: 0 }; }
});

// ── messaging (popup ⇄ worker) ────────────────────────────────────────────
/** Everything the popup needs, already evaluated by the shared engine. */
async function snapshot() {
  const state = await loadState();
  const now = Date.now();
  const verdict = evaluateBlocking(state, now);
  const grouped = rulesByKind(state);
  // Attach the live verdict to each rule so the popup can show ON / PAUSED /
  // "runs on a schedule" without re-implementing any of the engine's logic.
  const withReason = (rule) => ({ ...rule, reasons: verdict.reasons[rule.id] || null });
  const { usage = {}, [KEY.account]: account = null } = await chrome.storage.local.get([
    KEY.usage,
    KEY.account,
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const usageToday = Object.entries(usage[today] || {})
    .map(([host, secs]) => ({ host, minutes: Math.round(secs / 60) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  return {
    account,
    status: describeBlocking(state, now),
    focus: verdict.focus,
    schedules: state.schedules.map((s) => ({
      ...s,
      running: verdict.schedules.some((r) => r.id === s.id),
    })),
    settings: state.settings,
    websites: grouped.websites.map(withReason),
    appRules: grouped.apps.map(withReason),
    usageToday,
    activeCounts: { websites: verdict.websites.length, apps: verdict.apps.length },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getState":
        return snapshot();

      case "addSite": {
        const host = normalizeHost(msg.host);
        if (!host) return { ok: false, error: "That doesn't look like a domain" };
        const state = await loadState();
        if (state.rules.some((r) => r.kind === "website" && r.target === host))
          return { ok: false, error: `${host} is already on the list` };
        const next = upsertRule(state, newRule({ kind: "website", target: host, when: msg.when || "always" }));
        await saveState(next);
        await syncRules("add-site");
        return { ok: true, host };
      }

      case "removeSite": {
        const state = await loadState();
        const rule = state.rules.find((r) => r.kind === "website" && r.target === normalizeHost(msg.host));
        if (!rule) return { ok: false, error: "Not on the list" };
        await saveState(removeRule(state, rule.id));
        await syncRules("remove-site");
        return { ok: true };
      }

      case "setRuleEnabled": {
        const state = await loadState();
        await saveState(setRuleEnabled(state, msg.id, msg.enabled));
        await syncRules("toggle-rule");
        return { ok: true };
      }

      /** Explicit, expiring pause: the engine re-blocks when it lapses. */
      case "unblockRule": {
        const state = await loadState();
        if (!state.rules.some((r) => r.id === msg.id)) return { ok: false, error: "Unknown rule" };
        await saveState(unblockUntil(state, msg.id, msg.minutes ?? state.settings.tempUnblockMinutes));
        await syncRules("temp-unblock");
        return { ok: true };
      }

      case "addSchedule": {
        const state = await loadState();
        const sched = newSchedule({
          name: (msg.name || "Schedule").trim() || "Schedule",
          days: Array.isArray(msg.days) ? msg.days : undefined,
          start: msg.start,
          end: msg.end,
        });
        if (sched.start === sched.end) return { ok: false, error: "Start and end must differ" };
        await saveState(upsertSchedule(state, sched));
        await syncRules("add-schedule");
        return { ok: true, id: sched.id };
      }

      case "removeSchedule": {
        const state = await loadState();
        await saveState(removeSchedule(state, msg.id));
        await syncRules("remove-schedule");
        return { ok: true };
      }

      case "setScheduleEnabled": {
        const state = await loadState();
        const sc = state.schedules.find((s) => s.id === msg.id);
        if (!sc) return { ok: false, error: "Unknown schedule" };
        await saveState(upsertSchedule(state, { ...sc, enabled: !!msg.enabled }));
        await syncRules("toggle-schedule");
        return { ok: true };
      }

      case "startFocus":
        return { ok: true, focus: await startFocusSession(Number(msg.minutes) || 25) };

      case "cancelFocus":
        await endFocusSession();
        return { ok: true };

      /**
       * Account linking is identity only. The extension records which NORTH
       * account it belongs to so the UI can say what it is enforcing for; the
       * rules themselves wait for the Supabase phase (SETUP.md) before they
       * travel between devices. Nothing here pretends to be a sync.
       */
      case "linkAccount": {
        const un = String(msg.un || "").trim().toLowerCase();
        if (!un) return { ok: false, error: "Enter the username from the web app" };
        await chrome.storage.local.set({ [KEY.account]: { un, linkedAt: Date.now() } });
        return { ok: true, account: { un, linkedAt: Date.now() } };
      }

      case "unlinkAccount": {
        await chrome.storage.local.remove(KEY.account);
        return { ok: true };
      }

      default:
        return { ok: false, error: "unknown message" };
    }
  })().then(sendResponse);
  return true; // async response
});

// Keep the running tab's clock honest and the verdict fresh from the start.
chrome.alarms.create(ALARMS.usageFlush, { periodInMinutes: 1 });
loadState().then(() => syncRules("boot"));
