/**
 * Focusly extension — background service worker (Manifest V3).
 *
 * Real capabilities only:
 *  - Focus sessions: wall-clock end time + alarms (survives service-worker
 *    suspension, which a naive setTimeout does not).
 *  - Website blocking: chrome.declarativeNetRequest dynamic rules built from
 *    the user's block list. This genuinely blocks navigation.
 *  - Usage tracking: time on the active tab is attributed to its domain and
 *    bucketed per day in chrome.storage.local.
 *
 * Deliberately NOT here (yet): posting to the Focusly backend, "block only
 * during focus" schedules, category detection. Those come with the Supabase
 * phase; nothing is faked in the meantime.
 */

const KEY = {
  blocked: "blockedSites", // string[] of hosts
  usage: "usage", // { "YYYY-MM-DD": { "domain": seconds } }
  focus: "focus", // { endAt, startedAt, minutes } | null
};

// ── Blocking ──────────────────────────────────────────────────────────────
// Dynamic DNR rules: one block rule per host. IDs are stable hashes so we
// can replace rules without churn. resourceTypes main_frame/sub_frame stops
// navigation without nuking sub-resources.
const ruleIdFor = (host) => {
  let h = 1;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return (h % 20000) + 1000; // dynamic rule IDs must be >= 1; keep a safe band
};

async function applyBlockRules(hosts) {
  const ruleIds = hosts.map(ruleIdFor);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const toRemove = existing
    .map((r) => r.id)
    .filter((id) => id >= 1000 && id < 21000);
  const toAdd = hosts.map((host) => ({
    id: ruleIdFor(host),
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${host}^`,
      resourceTypes: ["main_frame", "sub_frame"],
    },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: toRemove.filter((id) => !ruleIds.includes(id)),
    addRules: toAdd,
  });
}

// ── Focus sessions ────────────────────────────────────────────────────────
async function startFocus(minutes) {
  const startedAt = Date.now();
  const focus = { startedAt, minutes, endAt: startedAt + minutes * 60000 };
  await chrome.storage.local.set({ [KEY.focus]: focus });
  chrome.alarms.create("focus-end", { when: focus.endAt });
  try { // notifications need a bundled icon; fail quietly until one ships
    await chrome.notifications.create("focus-started", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: "Focus session started",
      message: `${minutes} minutes. Distracting sites stay blocked.`,
    });
  } catch {}
  return focus;
}

async function cancelFocus() {
  await chrome.storage.local.remove(KEY.focus);
  chrome.alarms.clear("focus-end");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "focus-end") return;
  await chrome.storage.local.remove(KEY.focus);
  try {
    await chrome.notifications.create("focus-done", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: "Focus session complete 🎉",
      message: "Great work — take a break.",
    });
  } catch {}
});

// ── Usage tracking ────────────────────────────────────────────────────────
const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};

let active = { tabId: null, host: null, since: 0 };

function bumpUsage(days) {
  // Persist only whole seconds and only at a coarse cadence (alarms/tab
  // switches) — never per page content, never any URL path or title.
  const s = active.host && active.since ? Math.floor((Date.now() - active.since) / 1000) : 0;
  if (!s || !active.host) return;
  chrome.storage.local.get(KEY.usage).then(({ usage = {} }) => {
    const date = new Date().toISOString().slice(0, 10);
    const day = usage[date] || (usage[date] = {});
    day[active.host] = (day[active.host] || 0) + s;
    chrome.storage.local.set({ [KEY.usage]: usage });
  });
  active.since = Date.now();
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
  if (active.tabId === tabId) active = { tabId: null, host: null, since: 0 };
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) active = { tabId: null, host: null, since: 0 };
});
// Alarms fire even when the worker is asleep → flush the running tab's time.
chrome.alarms.create("usage-flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "usage-flush") bumpUsage(); });

// ── Messaging (popup ⇄ worker) ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getState": {
        const { blocked = [], focus = null, usage = {} } = await chrome.storage.local.get(KEY);
        const today = new Date().toISOString().slice(0, 10);
        const list = Object.entries(usage[today] || {})
          .map(([host, secs]) => ({ host, minutes: Math.round(secs / 60) }))
          .sort((a, b) => b.minutes - a.minutes)
          .slice(0, 6);
        return { blocked, focus, usageToday: list };
      }
      case "addBlocked": {
        const host = String(msg.host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (!host) return { ok: false };
        const { blocked = [] } = await chrome.storage.local.get(KEY.blocked);
        const next = blocked.includes(host) ? blocked : [...blocked, host];
        await chrome.storage.local.set({ [KEY.blocked]: next });
        await applyBlockRules(next);
        return { ok: true, blocked: next };
      }
      case "removeBlocked": {
        const { blocked = [] } = await chrome.storage.local.get(KEY.blocked);
        const next = blocked.filter((h) => h !== msg.host);
        await chrome.storage.local.set({ [KEY.blocked]: next });
        await applyBlockRules(next);
        return { ok: true, blocked: next };
      }
      case "startFocus": return { ok: true, focus: await startFocus(Number(msg.minutes) || 25) };
      case "cancelFocus": await cancelFocus(); return { ok: true };
      default: return { ok: false, error: "unknown message" };
    }
  })().then(sendResponse);
  return true; // async response
});

// First install → seed the block list with sensible defaults (user edits in
// the popup; nothing is blocked without rules being applied above).
chrome.runtime.onInstalled.addListener(async () => {
  const { blocked } = await chrome.storage.local.get(KEY.blocked);
  if (!blocked) await chrome.storage.local.set({ [KEY.blocked]: ["youtube.com", "instagram.com", "reddit.com"] });
  await applyBlockRules(blocked || ["youtube.com", "instagram.com", "reddit.com"]);
});
