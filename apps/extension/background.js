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
 *  - Usage tracking: time on the active tab attributed to its domain, stored
 *    per day so it survives worker suspension. No paths, titles or page content.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *  - OS application blocking: a browser extension cannot see or touch other
 *    processes. That is the desktop client's job (see apps/desktop).
 *
 * ADDED IN 0.3
 *  - A real block page. The request is genuinely stopped by the browser (it
 *    never leaves the machine); the error page the browser shows in its place
 *    is then swapped for NORTH's own page, naming the domain and the reason.
 *  - Focus Mode from the web app. The running focus window is the one part of
 *    the blocking state that travels, so a session started in North actually
 *    blocks sites in this browser (see lib/account-merge.js).
 *  - A narrow channel from the North website (externally_connectable +
 *    lib/external.js): normal calls request usage/status or a re-sync; account
 *    pairing additionally requires a one-use nonce created by the extension.
 */

import * as northAuth from "./lib/north-auth.js";
import { readRestBody } from './lib/rest-body.js';
import { aggregateUsageRange, splitUsageInterval, selectUsageTabs, httpHost, summarizeDesktopUsage, observedInterval } from "./lib/usage.js";
import { splitHourlyInterval, mergeActivitySnapshots } from "./lib/activity.js";

// Restore the persisted session as soon as the worker wakes, so authStatus
// answers instantly and the badge can reflect the account state.
const authReady = northAuth.initAuth().catch(() => false);

import {
  normalizeState,
  normalizeHost,
  newRule,
  newSchedule,
  evaluateBlocking,
  describeBlocking,
  rulesByKind,
  upsertRule,
  upsertUsageLimit,
  removeUsageLimit,
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
import { planRules, hostMatches, RULE_ID_MIN, RULE_ID_MAX } from "./lib/dnr.js";
import { applyAccountBlocking, blockingToSettings, FOCUS_SOURCE } from "./lib/account-merge.js";
import { externalAction } from "./lib/external.js";
import { encodeReason, scheduleNames, blockPageUrl } from "./lib/block-reason.js";

const KEY = {
  /** v2 blocking state (rules/schedules/settings/unblocks/focus). */
  state: "northBlocking",
  /** Linked NORTH account — { un, linkedAt, authUserId?, email? } when real. */
  account: "northAccount",
  /** { "YYYY-MM-DD": { "domain": seconds } } — untouched by the v2 upgrade. */
  usage: "usage",
  hourlyUsage: "northHourlyUsage",
  /** UTC date string of the last usage upload, so a day uploads exactly once. */
  usageSyncedAt: "northUsageSyncedAt",
  /** Current tab timer survives MV3 service-worker suspension. */
  activeUsage: "northActiveUsage",
  /** Account which owns the current local usage bucket, if signed in before. */
  usageOwner: "northUsageOwnerId",
  /** Stable id for this browser collector; never leaves usage rows with account identity. */
  usageDevice: "northUsageDeviceId",
  /** Pre-v2 flat block list, read once by the migration below. */
  legacyBlocked: "blockedSites",
  /** Pre-v2 focus window, read once by the migration below. */
  legacyFocus: "focusWindow",
  /** The host list currently applied to the browser, so an unchanged verdict
   *  costs no IPC. Named (unlike a computed `KEY.applied`) because a computed
   *  key is the literal string "undefined". */
  applied: "northAppliedHosts",
  /** Whether the running focus window came from the account or this browser. */
  focusSource: "northFocusSource",
  /** { "YYYY-MM-DD": { "domain": count } } — blocked attempts, local only. */
  blocks: "northBlockedAttempts",
  /** When the account last reconciled, shown as "last sync" in the UI. */
  lastSync: "northLastSyncAt",
  theme: "northThemeId",
  blockingPending: "northBlockingPendingSync",
  audioUsage: "northTrackBackgroundAudio",
  sessionUsage: "northSessionUsage",
  pendingSessions: "northPendingSessions",
  desktopUsage: "northDesktopUsage",
  accountUsage: "northAccountActivity",
};

const ALARMS = { focusEnd: "focus-end", usageFlush: "usage-flush", blockSync: "block-sync" };
const SYNC_FLOOR_MS = 60 * 1000; // never wait longer than a minute to re-check
const consumedConnectNonces = new Set();

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

// ── account sync (same tables as web/mobile/desktop, one model) ───────────
/**
 * The extension is another client of the NORTH ecosystem: the signed-in
 * account's profile carries the authoritative blocking rules/schedules, and
 * this device's browsing usage posts to the same `usage_records` table the
 * schema already defines. REST only — the same RLS-protected PostgREST
 * endpoints the web app talks to, with the caller's own JWT. Never anything
 * but the caller's own rows; the server enforces it, and nothing here tries
 * to route around it.
 *
 * Ephemeral device state (running focus window, temporary unblocks, rule
 * enable-toggles made offline) stays local by design, exactly as SYNC.md
 * documents for every client: rules travel; countdowns and expiries do not.
 */
const KEYS_URL = "northSupabaseUrl";
const KEYS_KEY = "northSupabaseAnonKey";

const rest = (url, anonKey) => `${String(url).replace(/\/+$/, "")}/rest/v1`;

async function authContext() {    const [{ [KEY.account]: account }, { [KEYS_URL]: url }, { [KEYS_KEY]: anonKey }] = await Promise.all([
      chrome.storage.local.get(KEY.account),
      chrome.storage.local.get(KEYS_URL),
      chrome.storage.local.get(KEYS_KEY),
    ]);
  if (!account?.authUserId || !url || !anonKey) return null;
  const session = await northAuth.getSession();
  if (!session?.access_token) return null;
  return { account, url, anonKey, jwt: session.access_token, uid: account.authUserId };
}

async function postgrest(path, { method = "GET", body, jwt, url, anonKey } = {}) {
  const res = await fetch(`${rest(url, anonKey)}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(method === "GET" || path.startsWith('/rpc/') ? {} : { Prefer: "resolution=merge-duplicates,return=minimal" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const error = new Error(`sync ${method} ${path} → ${res.status}`);
    error.status = res.status;
    throw error;
  }
  // PostgREST return=minimal may succeed with 201 and an empty body too.
  return readRestBody(res);
}

async function usageDeviceId() {
  const raw = await chrome.storage.local.get(KEY.usageDevice);
  if (raw[KEY.usageDevice]) return raw[KEY.usageDevice];
  const id = globalThis.crypto?.randomUUID?.() || `extension-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.local.set({ [KEY.usageDevice]: id });
  return id;
}

async function uploadUsageRows(ctx, rows, deviceId) {
  try {
    await postgrest(`/usage_records?on_conflict=user_id,day,kind,name,device_id`, {
      method: "POST", jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey, body: rows.map((row) => ({ ...row, device_id: deviceId, source: "extension" })),
    });
  } catch (error) {
    // Backward compatible until the additive migration is applied. Once the
    // new columns exist, the first request is the only path used.
    if (error?.status !== 400) throw error;
    await postgrest(`/usage_records?on_conflict=user_id,day,kind,name`, {
      method: "POST", jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey, body: rows,
    });
  }
}

/** The focus window's provenance — see lib/account-merge.js for the policy. */
const readFocusSource = async () =>
  (await chrome.storage.local.get(KEY.focusSource))[KEY.focusSource] || null;
const writeFocusSource = (source) =>
  source
    ? chrome.storage.local.set({ [KEY.focusSource]: source })
    : chrome.storage.local.remove(KEY.focusSource);

/** One full round trip: pull the account's rules, then push this device's. */
async function syncAccount() {
  const ctx = await authContext();
  if (!ctx) return { ok: false, reason: "signed_out" };
  try {
    const me = await postgrest(
      `/profiles?id=eq.${ctx.uid}&select=id,un,settings`,
      { jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey }
    );
    let profile = Array.isArray(me) ? me[0] : null;
    if (!profile) return { ok: false, reason: "no_profile" };
    await chrome.storage.local.set({ northInterfaceSounds: Boolean(profile.settings?.pm?.interfaceSounds) });
    await chrome.storage.local.set({ northAppearance: profile.settings?.appearance || null });
    const theme = profile.settings?.theme;
    if (typeof theme === "string" && /^[a-z][a-z0-9-]{1,40}$/.test(theme)) {
      await chrome.storage.local.set({ [KEY.theme]: theme });
    }

    const state = await loadState();
    const { [KEY.blockingPending]: blockingPending = false } = await chrome.storage.local.get(KEY.blockingPending);
    if (blockingPending) {
      profile = await writeBlockingToAccount(state, ctx, profile);
      await chrome.storage.local.remove(KEY.blockingPending);
    }
    const before = JSON.stringify([state.rules, state.schedules, state.usageLimits]);
    const focusBefore = state.focus ? Number(state.focus.endAt) : 0;
    // The account document is the control centre: rules/schedules/settings come
    // from it, and so does a running Focus Mode session. Temporary unblocks and
    // any focus session this browser started itself stay untouched.
    const { state: merged, focusSource } = applyAccountBlocking(state, profile.settings, {
      now: Date.now(),
      focusSource: await readFocusSource(),
    });
    const focusAfter = merged.focus ? Number(merged.focus.endAt) : 0;
    const focusChanged = focusAfter !== focusBefore;

    if (JSON.stringify([merged.rules, merged.schedules, merged.usageLimits]) !== before || focusChanged) {
      await saveState(merged);
      await writeFocusSource(focusSource);
      if (focusChanged) {
        // A Focus Mode session started (or ended) in North has to re-arm this
        // browser's session-end alarm too — otherwise a session adopted from
        // the account would never stop on its own.
        if (focusAfter > Date.now()) chrome.alarms.create(ALARMS.focusEnd, { when: focusAfter });
        else chrome.alarms.clear(ALARMS.focusEnd);
      }
      await syncRules(focusChanged ? "account-focus" : "account-pull");
    }

    // Routine pulls must not publish an earlier snapshot over a newer edit.
    // Explicit edits publish through commitBlocking/writeBlockingToAccount.
    await chrome.storage.local.set({ [KEY.lastSync]: Date.now() });
    // Desktop reports the same account's foreground activity through usage_records.
    // Cache it separately: it must never spend this browser's website allowance.
    try {
      const day = new Date().toISOString().slice(0, 10);
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const from = new Date(Date.parse(`${day}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
        const page = await postgrest(`/usage_records?user_id=eq.${ctx.uid}&day=gte.${from}&day=lte.${day}&select=day,kind,name,seconds,device_id,hourly&order=day,kind,name,device_id&limit=1000&offset=${offset}`, {
          jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey,
        });
        rows.push(...(page || []));
        if (!page || page.length < 1000) break;
      }
      const latest = (await chrome.storage.local.get(KEY.account))[KEY.account];
      if (latest?.authUserId === ctx.uid) {
        await chrome.storage.local.set({
          [KEY.desktopUsage]: { owner: ctx.uid, day, rows: summarizeDesktopUsage(rows.filter((row) => row.day === day)) },
          [KEY.accountUsage]: { owner: ctx.uid, rows, hiddenSites: profile.settings?.hiddenUsageSites || [] },
        });
      }
    } catch { /* Keep the account-scoped last snapshot while offline. */ }
    return { ok: true, focus: focusAfter > Date.now() ? { endAt: focusAfter } : null };
  } catch (e) {
    console.debug("[north] account sync failed:", e?.message || e);
    return { ok: false, reason: String(e?.message || e) };
  }
}

async function writeBlockingToAccount(state, ctx, profile) {
  const settings = blockingToSettings(state);
  settings.blocking.focus = profile.settings?.blocking?.focus || null;
  await postgrest(`/profiles?id=eq.${ctx.uid}`, {
    method: "PATCH", jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey,
    body: { settings: { ...(profile.settings || {}), ...settings } },
  });
  return { ...profile, settings: { ...(profile.settings || {}), ...settings } };
}

async function commitBlocking(state, reason) {
  await saveState(state);
  try {
    const ctx = await authContext();
    if (ctx) {
      // Only queue a cloud publish for a real signed-in account. A local-only
      // edit must not overwrite account rules on a later sign-in.
      await chrome.storage.local.set({ [KEY.blockingPending]: true });
      const me = await postgrest(`/profiles?id=eq.${ctx.uid}&select=id,un,settings`, {
        jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey,
      });
      const profile = Array.isArray(me) ? me[0] : null;
      if (profile) {
        await writeBlockingToAccount(state, ctx, profile);
        await chrome.storage.local.remove(KEY.blockingPending);
        await chrome.storage.local.set({ [KEY.lastSync]: Date.now() });
      }
    }
  } catch (error) {
    console.debug("[north] blocking change queued for sync:", error?.message || error);
  }
  await syncRules(reason);
}

/**
 * Upload the current day too so other North clients can show recent activity.
 * Completed-day markers advance only after a successful upload.
 */
let usageSyncing = null;
async function syncUsage() {
  if (usageSyncing) return usageSyncing;
  usageSyncing = (async () => {
    const ctx = await authContext();
    if (!ctx) return;
    try {
    // Attribute pre-sign-in device usage to the first account only. On account
    // changes, archive each user's local bucket so browsing history never
    // uploads into somebody else's account.
    await bumpUsage();
    const { [KEY.usage]: current = {}, [KEY.hourlyUsage]: currentHourly = {}, [KEY.usageOwner]: owner = null, [KEY.usageSyncedAt]: marker = null } =
      await chrome.storage.local.get([KEY.usage, KEY.hourlyUsage, KEY.usageOwner, KEY.usageSyncedAt]);
    if (owner && owner !== ctx.uid) {
      const previousKey = `northUsageArchive:${owner}`;
      const nextKey = `northUsageArchive:${ctx.uid}`;
      await chrome.storage.local.set({ [previousKey]: { usage: current, hourly: currentHourly, syncedAt: marker } });
      const { [nextKey]: next = null } = await chrome.storage.local.get(nextKey);
      await chrome.storage.local.set({
        [KEY.usage]: next?.usage || {},
        [KEY.hourlyUsage]: next?.hourly || {},
        [KEY.usageSyncedAt]: next?.syncedAt || null,
        [KEY.usageOwner]: ctx.uid,
      });
      await chrome.storage.local.remove(nextKey);
    } else if (!owner) {
      await chrome.storage.local.set({ [KEY.usageOwner]: ctx.uid });
    }
    const { [KEY.usage]: usage = {}, [KEY.usageSyncedAt]: done = null } =
      await chrome.storage.local.get([KEY.usage, KEY.usageSyncedAt]);
    const deviceId = await usageDeviceId();
    const hourlyUsage = (await chrome.storage.local.get(KEY.hourlyUsage))[KEY.hourlyUsage] || {};
    const today = new Date().toISOString().slice(0, 10);
    const dates = Object.keys(usage)
      .filter((d) => d <= today && (d === today || !done || d > done))
      .sort();
    for (const day of dates) {
      const rows = Object.entries(usage[day] || {})
        .filter(([domain, secs]) => Number(secs) > 0)
        .map(([domain, secs]) => ({
          user_id: ctx.uid, day, kind: "website", name: domain,
          seconds: Math.floor(Number(secs) || 0),
          hourly: hourlyUsage[day]?.[domain] || {},
        }));
      if (rows.length) {
        await uploadUsageRows(ctx, rows, deviceId);
      }
    }
    const completed = dates.filter((day) => day < today);
    if (completed.length) {
      await chrome.storage.local.set({ [KEY.usageSyncedAt]: completed[completed.length - 1] });
    }
    } catch (e) {
      console.debug("[north] usage upload deferred:", e?.message || e);
      throw e;
    }
  })().finally(() => { usageSyncing = null; });
  return usageSyncing;
}

/** Sign-out cleanup: the account's synced rules leave; a fresh local slate stays. */
async function onSignOutCleanup() {
  const state = await loadState();
  const fresh = normalizeState({ ...state, rules: [], usageLimits: [], schedules: [], focus: null, unblocks: {} });
  await saveState(fresh);
  await chrome.storage.local.remove([KEY.blockingPending, KEY.lastSync, KEY.desktopUsage, KEY.accountUsage]);
  await syncRules("sign-out");
}

async function currentUsageSeconds() {
  await bumpUsage();
  const rows = await accountActivity(false);
  const today = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(rows.filter((row) => row.day === today && row.kind === "website").map((row) => [row.name, row.seconds]));
}

async function accountActivity(hideExcluded = true, extra = []) {
  const raw = await chrome.storage.local.get([KEY.usage, KEY.hourlyUsage, KEY.usageOwner, KEY.account, KEY.accountUsage]);
  const owner = raw[KEY.account]?.authUserId;
  const cached = raw[KEY.accountUsage]?.owner === owner ? raw[KEY.accountUsage] : null;
  const local = [];
  if (!raw[KEY.usageOwner] || raw[KEY.usageOwner] === owner) {
    const device = await usageDeviceId();
    for (const [day, sites] of Object.entries(raw[KEY.usage] || {})) {
      for (const [name, seconds] of Object.entries(sites)) local.push({ day, name, seconds, kind: "website", device_id: device, hourly: raw[KEY.hourlyUsage]?.[day]?.[name] || {} });
    }
  }
  return mergeActivitySnapshots([...(cached?.rows || []), ...extra, ...local]).filter((row) => !hideExcluded
    || !(cached?.hiddenSites || []).some((site) => row.kind === "app"
      ? site === `app:${row.name.toLowerCase().replace(/\.exe$/, "")}`
      : !site.startsWith("app:") && (row.name === site || row.name.endsWith(`.${site}`))));
}

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
      const verdict = evaluateBlocking(state, now, await currentUsageSeconds());
      await applyBlockRules(verdict.websites);
      // Daily caps also take effect on pages that are already open.
      const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
      await Promise.all(tabs.filter((tab) => verdict.websites.some((target) => hostMatches(target, httpHost(tab.pendingUrl || tab.url))))
        .map((tab) => showBlockPage(tab.id, tab.pendingUrl || tab.url, { state, verdict })));

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
/**
 * Push the desired host list into the browser as dynamic rules.
 *
 * The decision of *which* rules should exist is `planRules` (lib/dnr.js), which
 * is pure and tested; this function only carries out its answer and remembers
 * what was applied so an unchanged verdict costs no IPC. Rules another
 * extension or the manifest wrote are never touched — only our own id band.
 */
async function applyBlockRules(hosts) {
  const want = [...new Set(hosts)].sort();
  const { [KEY.applied]: have = null } = await chrome.storage.local.get(KEY.applied);
  // Skip the IPC when nothing changed — this runs up to once a minute.
  if (Array.isArray(have) && have.length === want.length && have.every((h, i) => h === want[i])) return;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const { addRules, removeRuleIds, unchanged } = planRules(want, existing.map((r) => r.id));
  if (!unchanged) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    console.debug(`[north] browser rules: +${addRules.length} -${removeRuleIds.length} (band ${RULE_ID_MIN}–${RULE_ID_MAX})`);
  }
  // Recorded even when the diff was empty: "want" is the state of the world,
  // not a description of what changed.
  await chrome.storage.local.set({ [KEY.applied]: want });
}

// ── the block page ────────────────────────────────────────────────────────
/**
 * Replace the browser's own error page with NORTH's, carrying the domain and
 * the reason the engine gave.
 *
 * The block itself already happened — `declarativeNetRequest` stopped the
 * request before it left the machine, which is why `onErrorOccurred` reports
 * ERR_BLOCKED_BY_CLIENT. All this does is make the result legible (and count
 * the attempt, which is what "not today" is actually made of).
 */
const redirectingTabs = new Set();
async function showBlockPage(tabId, blockedUrl, known) {
  if (redirectingTabs.has(tabId)) return;
  redirectingTabs.add(tabId);
  try {
    const state = known?.state || await loadState();
    const now = Date.now();
    const verdict = known?.verdict || evaluateBlocking(state, now, await currentUsageSeconds());
    const host = hostOf(blockedUrl);
    if (!host || !verdict.websites.some((target) => hostMatches(target, host))) return;
    // Which rule stopped this page — the engine's own reason, never a guess.
    const rule = state.rules.find((r) => r.kind === "website" && verdict.reasons[r.id] && hostMatches(r.target, host));
    const limit = state.usageLimits.find((item) => verdict.reasons[item.id]?.reason === "daily-limit" && hostMatches(item.target, host));
    const blocker = rule || limit;
    const reason = blocker ? verdict.reasons[blocker.id]?.reason : "always";
    const url = blockPageUrl(chrome.runtime.getURL("blocked.html"), {
      domain: host || "",
      code: encodeReason(reason),
      names: scheduleNames(reason),
      minutesLeft: verdict.focus.active ? verdict.focus.minutesLeft : 0,
      ruleId: blocker?.id,
    });
    await chrome.tabs.update(tabId, { url });
    await bumpBlockedAttempt(host);
  } catch (e) {
    console.debug("[north] could not show the block page:", e?.message || e);
  } finally { redirectingTabs.delete(tabId); }
}

/** Count a blocked attempt per domain per day. Local only — see README. */
async function bumpBlockedAttempt(host) {
  if (!host) return;
  try {
    const { [KEY.blocks]: blocks = {} } = await chrome.storage.local.get(KEY.blocks);
    const date = new Date().toISOString().slice(0, 10);
    const day = blocks[date] || (blocks[date] = {});
    day[host] = (day[host] || 0) + 1;
    // Keep a fortnight; this is a nudge, not an archive.
    for (const d of Object.keys(blocks)) if (d < new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)) delete blocks[d];
    await chrome.storage.local.set({ [KEY.blocks]: blocks });
  } catch { /* counting is best-effort and never blocks the page */ }
}

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // Only top-level navigations: an embedded frame that gets blocked should not
  // replace the page the person is actually reading.
  if (details.frameId !== 0) return;
  if (details.error !== "net::ERR_BLOCKED_BY_CLIENT") return;
  if (String(details.url || "").startsWith(chrome.runtime.getURL(""))) return;
  showBlockPage(details.tabId, details.url);
});

// ── focus sessions ────────────────────────────────────────────────────────
async function startFocusSession(minutes) {
  const state = await loadState();
  const focus = startFocus(minutes, Date.now());
  await saveState({ ...state, focus });
  // Started here, so it belongs to this browser: a later account pull that has
  // no Focus Mode running must not cancel it (see lib/account-merge.js).
  await writeFocusSource(FOCUS_SOURCE.local);
  chrome.alarms.create(ALARMS.focusEnd, { when: focus.endAt });
  await syncRules("focus-start");
  try {
    await chrome.notifications.create("focus-started", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("north-logo.png"),
      title: "Focus session started",
      message: `${focus.minutes} minutes. Your rules are being enforced.`,
    });
  } catch { /* notifications unavailable — the session itself is unaffected */ }
  return focus;
}

async function endFocusSession() {
  const state = await loadState();
  await saveState({ ...state, focus: null });
  await writeFocusSource(null);
  chrome.alarms.clear(ALARMS.focusEnd);
  await syncRules("focus-end");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARMS.focusEnd: {
      const state = await loadState();
      if (!focusActive(state.focus, Date.now())) {
        await saveState({ ...state, focus: null });
        await writeFocusSource(null);
      }
      await syncRules("focus-end");
      try {
        await chrome.notifications.create("focus-done", {
          type: "basic",
          iconUrl: chrome.runtime.getURL("north-logo.png"),
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
      await bumpUsage();
      // Security net: if a boundary alarm was missed (asleep laptop, update),
      // the verdict is still re-checked within a minute.
      await syncRules("tick");
      // Signed in: keep the account fresh (rules down/up + yesterday's usage).
      syncAccount().catch(() => {});
      syncUsage().catch(() => {});
      break;
  }
});

chrome.runtime.onStartup.addListener(() => {
  syncRules("startup");
  startUsageForFocusedTab();
});
chrome.runtime.onInstalled.addListener(async (details) => {
  await loadState(); // triggers the one-time migration
  await startUsageForFocusedTab();
  if (details.reason === "install") {
    // A new install starts EMPTY, and says so. It would be easy to seed a
    // "sensible" list here, but those rules are not the user's: they would be
    // pushed into their NORTH account as if they had chosen them, and a
    // blocker that silently blocks things nobody asked for is the one thing a
    // focus tool cannot afford to be. Sites come from the popup or North Guard.
    await syncRules("install");
    return;
  }
  await syncRules("install");
});

// ── usage tracking (per-domain seconds per day) ───────────────────────────
const hostOf = httpHost;

let usageQueue = Promise.resolve();
// Survives worker suspension, but is cleared on browser restart.
const browserSessionReady = chrome.storage.session.get("northBrowserSession").then(async (raw) => {
  const id = raw.northBrowserSession || crypto.randomUUID();
  await chrome.storage.session.set({ northBrowserSession: id });
  return id;
});
const serializeUsage = (fn) => {
  const job = usageQueue.then(fn, fn);
  usageQueue = job.catch(() => {});
  return job;
};

async function recordUsage(until = Date.now(), clear = false) {
  const browserSession = await browserSessionReady;
  const raw = await chrome.storage.local.get([KEY.usage, KEY.hourlyUsage, KEY.activeUsage, KEY.sessionUsage]);
  const usage = raw[KEY.usage] || {};
  const hourlyUsage = raw[KEY.hourlyUsage] || {};
  const sessions = raw[KEY.sessionUsage] || {};
  const active = raw[KEY.activeUsage];
  const tracks = Array.isArray(active) ? active : (active?.host ? [active] : []);
  for (const track of tracks) {
    const interval = observedInterval(track, until, browserSession);
    if (!track.host || !interval) continue;
    const elapsed = (interval.endAt - interval.startAt) / 1000;
    for (const row of splitUsageInterval(track.host, interval.startAt, interval.endAt)) {
      const day = usage[row.day] || (usage[row.day] = {});
      day[row.host] = (day[row.host] || 0) + row.seconds;
    }
    for (const row of splitHourlyInterval(interval.startAt, interval.endAt)) {
      const day = hourlyUsage[row.day] || (hourlyUsage[row.day] = {});
      const hours = day[track.host] || (day[track.host] = {});
      hours[row.hour] = (hours[row.hour] || 0) + row.seconds;
    }
    // Session caps use the same foreground-only time as usage statistics.
    const session = sessions[String(track.tabId)];
    if (session?.host === track.host && !session.expired) {
      session.usedSeconds = Math.min(session.limitSeconds, (session.usedSeconds || 0) + elapsed);
      if (session.usedSeconds >= session.limitSeconds) {
        session.expired = true;
        const pending = raw[KEY.pendingSessions] || {};
        pending[String(track.tabId)] = { host: session.host, limitId: session.limitId, url: session.url };
        raw[KEY.pendingSessions] = pending;
        const url = new URL(chrome.runtime.getURL("session-limit.html"));
        url.searchParams.set("domain", session.host);
        url.searchParams.set("expired", "1");
        url.searchParams.set("tabId", String(track.tabId));
        chrome.tabs.update(track.tabId, { url: url.toString() }).catch(() => {});
      }
    }
  }
  const next = !clear ? tracks.map((track) => ({ ...track, since: until })) : [];
  await chrome.storage.local.set({ [KEY.usage]: usage, [KEY.hourlyUsage]: hourlyUsage, [KEY.activeUsage]: next, [KEY.sessionUsage]: sessions, [KEY.pendingSessions]: raw[KEY.pendingSessions] || {} });
  return usage;
}

async function interceptSessionVisit(details) {
  if (details.frameId !== 0 || String(details.url || "").startsWith(chrome.runtime.getURL(""))) return;
  const host = hostOf(details.url);
  if (!host) return;
  const [state, raw] = await Promise.all([
    loadState(), chrome.storage.local.get([KEY.sessionUsage, KEY.pendingSessions]),
  ]);
  const verdict = evaluateBlocking(state, Date.now(), await currentUsageSeconds());
  if (verdict.websites.some((target) => hostMatches(target, host))) {
    await showBlockPage(details.tabId, details.url, { state, verdict });
    return;
  }
  const limit = state.usageLimits.find((item) => item.enabled && item.kind === "website" && item.mode === "session" && hostMatches(item.target, host));
  const sessions = raw[KEY.sessionUsage] || {};
  const current = sessions[String(details.tabId)];
  if (!limit) {
    if (current && current.host !== host) {
      delete sessions[String(details.tabId)];
      await chrome.storage.local.set({ [KEY.sessionUsage]: sessions });
    }
    return;
  }
  if (current?.host === host && !current.expired) return;

  const pending = raw[KEY.pendingSessions] || {};
  if (pending[String(details.tabId)]?.url === details.url) return;
  pending[String(details.tabId)] = { host, limitId: limit.id, url: details.url };
  await chrome.storage.local.set({ [KEY.pendingSessions]: pending });
  const prompt = new URL(chrome.runtime.getURL("session-limit.html"));
  prompt.searchParams.set("domain", host);
  prompt.searchParams.set("tabId", String(details.tabId));
  await chrome.tabs.update(details.tabId, { url: prompt.toString() }).catch(() => {});
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => { void interceptSessionVisit(details); });

const bumpUsage = () => startUsageForFocusedTab({ validate: true });

async function setActive(tabId, url) {
  void tabId; void url;
  return startUsageForFocusedTab();
}

async function startUsageForFocusedTab({ validate = false } = {}) {
  return serializeUsage(async () => {
    try {
      const win = await chrome.windows.getLastFocused();
      const idleState = await chrome.idle.queryState(60);
      let active = null;
      if (win.focused && idleState === "active") {
        [active] = await chrome.tabs.query({ active: true, windowId: win.id });
      }
      const browserSession = await browserSessionReady;
      const tracks = selectUsageTabs(active, hostOf).map((track) => ({ ...track, browserSession }));
      if (validate && !tracks.length) {
        await chrome.storage.local.set({ [KEY.activeUsage]: [] });
      }
      await recordUsage(Date.now(), true);
      await chrome.storage.local.set({ [KEY.activeUsage]: tracks });
    } catch { await chrome.storage.local.set({ [KEY.activeUsage]: [] }); }
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const t = await chrome.tabs.get(tabId);
    await setActive(tabId, t.pendingUrl || t.url);
  } catch { /* tab closed between events */ }
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.active) void setActive(tabId, info.url);
  else if (info.status === "complete" && tab.active) void setActive(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.local.get([KEY.sessionUsage, KEY.pendingSessions]).then(async (raw) => {
    const sessions = raw[KEY.sessionUsage] || {};
    const pending = raw[KEY.pendingSessions] || {};
    delete sessions[String(tabId)]; delete pending[String(tabId)];
    await chrome.storage.local.set({ [KEY.sessionUsage]: sessions, [KEY.pendingSessions]: pending });
  });
  void startUsageForFocusedTab();
});
chrome.windows.onFocusChanged.addListener((winId) => {
  void winId;
  void startUsageForFocusedTab();
});
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(() => { void startUsageForFocusedTab(); });
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.audible !== undefined || (info.url && tab.active)) void startUsageForFocusedTab();
});

// ── messaging (popup ⇄ worker) ────────────────────────────────────────────
/** Everything the popup needs, already evaluated by the shared engine. */
async function snapshot() {
  const usageTodaySeconds = await currentUsageSeconds();
  const deviceId = await usageDeviceId();
  const state = await loadState();
  const now = Date.now();
  const verdict = evaluateBlocking(state, now, usageTodaySeconds);
  const grouped = rulesByKind(state);
  // Attach the live verdict to each rule so the popup can show ON / PAUSED /
  // "runs on a schedule" without re-implementing any of the engine's logic.
  const withReason = (rule) => ({ ...rule, reasons: verdict.reasons[rule.id] || null });
  const { [KEY.account]: account = null } = await chrome.storage.local.get(KEY.account);
  const today = new Date().toISOString().slice(0, 10);
  const usageToday = Object.entries(usageTodaySeconds)
    .map(([host, secs]) => ({ host, seconds: Math.floor(secs), minutes: Math.floor(secs / 60) }))
    .sort((a, b) => b.seconds - a.seconds);

  // Which page is in front right now, and does NORTH block it? Answered from
  // the same verdict the browser enforces, through the same matcher the rules
  // are built from, so the popup cannot disagree with reality.
  let current = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = hostOf(tab?.url || "");
    if (host) {
      const target = verdict.websites.find((t) => hostMatches(t, host));
      const rule = target ? grouped.websites.find((r) => r.target === target && verdict.reasons[r.id]) : null;
      const limit = target ? state.usageLimits.find((item) => item.target === target) : null;
      const blocker = rule || limit;
      current = {
        host,
        blocked: Boolean(target),
        paused: blocker ? verdict.reasons[blocker.id]?.reason === "temp-unblock" : false,
        ruleId: blocker?.id || null,
        reason: blocker ? verdict.reasons[blocker.id]?.reason || null : null,
      };
    }
  } catch { /* no active tab — the popup just shows nothing for it */ }

  const { [KEY.blocks]: blocks = {}, [KEY.lastSync]: lastSync = null, [KEY.theme]: theme = "violet-dusk" } =
    await chrome.storage.local.get([KEY.blocks, KEY.lastSync, KEY.theme]);
  const usageStore = (await chrome.storage.local.get(KEY.usage))[KEY.usage] || {};
  const activityRows = (await accountActivity()).filter((row) => row.kind === "website");
  const activityToday = activityRows.filter((row) => row.day === today).map((row) => ({ host: row.name, kind: row.kind, seconds: Math.floor(row.seconds) })).sort((a, b) => b.seconds - a.seconds);
  const usageHourly = Array.from({ length: 24 }, (_, hour) => ({
    day: `${today}:${hour}`, label: `${hour}:00`,
    seconds: activityRows.filter((row) => row.day === today).reduce((sum, row) => sum + (Number(row.hourly?.[hour]) || 0), 0),
  }));
  const usageWeek = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (6 - i));
    const day = date.toISOString().slice(0, 10);
    const seconds = activityRows.filter((row) => row.day === day).reduce((sum, row) => sum + row.seconds, 0);
    return { day, label: date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }), seconds };
  });
  const blockedToday = Object.entries(blocks[today] || {})
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const desktopCache = (await chrome.storage.local.get(KEY.desktopUsage))[KEY.desktopUsage];
  const desktopUsageToday = account?.authUserId && desktopCache?.owner === account.authUserId && desktopCache.day === today
    ? desktopCache.rows || [] : [];
  const usageLimits = state.usageLimits.map((limit) => {
    if (limit.kind === "app") {
      const usedSeconds = desktopUsageToday.filter((row) => row.name.toLowerCase().replace(/\.exe$/, "") === limit.target.toLowerCase().replace(/\.exe$/, ""))
        .reduce((sum, row) => sum + row.seconds, 0);
      return { ...limit, usedSeconds, reached: limit.mode === "daily" && usedSeconds >= limit.dailyLimitMinutes * 60 };
    }
    if (limit.mode === "session") return { ...limit, usedSeconds: 0, reached: false };
    const usedSeconds = Object.entries(usageTodaySeconds).reduce((total, [host, seconds]) =>
      total + (hostMatches(limit.target, host) ? Number(seconds) || 0 : 0), 0);
    return { ...limit, usedSeconds: Math.floor(usedSeconds), reached: usedSeconds >= limit.dailyLimitMinutes * 60 };
  });

  return {
    version: chrome.runtime.getManifest().version,
    theme,
    appearance: (await chrome.storage.local.get("northAppearance")).northAppearance || null,
    interfaceSounds: Boolean((await chrome.storage.local.get("northInterfaceSounds")).northInterfaceSounds),
    account,
    signedIn: Boolean(account?.authUserId),
    authConfigured: northAuth.isConfigured(),
    lastSync,
    current,
    blockedToday,
    status: describeBlocking(state, now, usageTodaySeconds),
    focus: verdict.focus,
    schedules: state.schedules.map((s) => ({
      ...s,
      running: verdict.schedules.some((r) => r.id === s.id),
    })),
    settings: state.settings,
    websites: grouped.websites.map(withReason),
    usageLimits,
    appRules: grouped.apps.map(withReason),
    usageToday,
    desktopUsageToday,
    activityToday,
    usageHourly,
    usageDeviceId: deviceId,
    usageWeek,
    trackBackgroundAudio: false,
    activeCounts: { websites: verdict.websites.length, apps: verdict.apps.length },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    // Auth message paths require the persisted session to be initialized;
    // blocking paths run regardless (the extension works signed out).
    if (String(msg?.type || "").startsWith("auth")) await authReady;
    switch (msg?.type) {
      case "getState":
        await authReady;
        return snapshot();

      case "getUsageRange": {
        await bumpUsage();
        const store = (await chrome.storage.local.get(KEY.usage))[KEY.usage] || {};
        const result = aggregateUsageRange(store, String(msg.from || ""), String(msg.to || ""));
        if (!result) return { ok: false, error: "Choose a valid date range." };
        const extra = [];
        try {
          const ctx = await authContext();
          if (ctx) {
            for (let offset = 0; ; offset += 1000) {
              const page = await postgrest(`/usage_records?user_id=eq.${ctx.uid}&day=gte.${result.from}&day=lte.${result.to}&select=day,kind,name,seconds,device_id,hourly&order=day,kind,name,device_id&limit=1000&offset=${offset}`, { jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey });
              extra.push(...(page || []));
              if (!page || page.length < 1000) break;
            }
          }
        } catch { /* Offline: retain available cached activity. */ }
        const rows = (await accountActivity(true, extra)).filter((row) => row.kind === "website" && row.day >= result.from && row.day <= result.to);
        const totals = new Map();
        for (const row of rows) {
          const key = `${row.kind}:${row.name}`;
          const previous = totals.get(key) || { host: row.name, kind: row.kind, seconds: 0 };
          previous.seconds += Math.floor(row.seconds); totals.set(key, previous);
        }
        const chart = result.from === result.to
          ? Array.from({ length: 24 }, (_, hour) => ({ day: `${result.from}:${hour}`, label: `${hour}:00`, seconds: rows.reduce((sum, row) => sum + (Number(row.hourly?.[hour]) || 0), 0) }))
          : Array.from({ length: result.days }, (_, index) => {
            const day = new Date(Date.parse(`${result.from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10);
            return { day, label: day.slice(5), seconds: rows.filter((row) => row.day === day).reduce((sum, row) => sum + row.seconds, 0) };
          });
        return { ok: true, ...result, usage: [...totals.values()].sort((a, b) => b.seconds - a.seconds), chart };
      }

      case "clearUsageHistory": {
        await serializeUsage(() => recordUsage(Date.now(), true));
        const all = await chrome.storage.local.get(null);
        const archiveKeys = Object.keys(all).filter((key) => key.startsWith("northUsageArchive:"));
        await chrome.storage.local.remove([
          KEY.usage, KEY.usageSyncedAt, KEY.blocks, KEY.activeUsage,
          KEY.sessionUsage, KEY.pendingSessions, ...archiveKeys,
        ]);
        return { ok: true };
      }

      case "setBackgroundAudio": {
        // Old popups may still send this preference; background usage is disabled.
        await chrome.storage.local.set({ [KEY.audioUsage]: false });
        await startUsageForFocusedTab();
        return { ok: true };
      }

      case "addSite": {
        const host = normalizeHost(msg.host);
        if (!host) return { ok: false, error: "That doesn't look like a domain" };
        const state = await loadState();
        if (state.rules.some((r) => r.kind === "website" && r.target === host))
          return { ok: false, error: `${host} is already on the list` };
        const next = upsertRule(state, newRule({ kind: "website", target: host, when: msg.when || "always" }));
        await commitBlocking(next, "add-site");
        return { ok: true, host };
      }

      case "removeSite": {
        const state = await loadState();
        const rule = state.rules.find((r) => r.kind === "website" && r.target === normalizeHost(msg.host));
        if (!rule) return { ok: false, error: "Not on the list" };
        await commitBlocking(removeRule(state, rule.id), "remove-site");
        return { ok: true };
      }

      case "setRuleEnabled": {
        const state = await loadState();
        await commitBlocking(setRuleEnabled(state, msg.id, msg.enabled), "toggle-rule");
        return { ok: true };
      }

      case "addUsageLimit": {
        const host = normalizeHost(msg.host);
        const mode = msg.mode === "session" ? "session" : "daily";
        const minutes = Number(msg.minutes);
        if (!host) return { ok: false, error: "Enter a website domain" };
        if (mode === "daily" && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) return { ok: false, error: "Choose a daily limit from 1 to 1440 minutes" };
        const state = await loadState();
        if (state.usageLimits.some((limit) => limit.kind === "website" && limit.target === host)) return { ok: false, error: `${host} already has a usage limit` };
        await commitBlocking(upsertUsageLimit(state, { target: host, mode, dailyLimitMinutes: minutes, name: msg.name }), "add-usage-limit");
        return { ok: true };
      }

      case "setUsageLimit": {
        const state = await loadState();
        const limit = state.usageLimits.find((item) => item.id === msg.id);
        if (!limit) return { ok: false, error: "Unknown usage limit" };
        const minutes = Number(msg.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return { ok: false, error: "Choose a limit from 1 to 1440 minutes" };
        await commitBlocking(upsertUsageLimit(state, { ...limit, dailyLimitMinutes: minutes }), "edit-usage-limit");
        return { ok: true };
      }

      case "beginSessionLimit": {
        const tabId = Number(msg.tabId);
        const minutes = Number(msg.minutes);
        if (!Number.isInteger(tabId) || !Number.isInteger(minutes) || minutes < 1 || minutes > 240)
          return { ok: false, error: "Choose a session from 1 to 240 minutes" };
        const raw = await chrome.storage.local.get([KEY.pendingSessions, KEY.sessionUsage]);
        const pending = raw[KEY.pendingSessions] || {};
        const request = pending[String(tabId)];
        if (!request || request.host !== normalizeHost(msg.host)) return { ok: false, error: "This session request has expired; reopen the site to choose again." };
        const sessions = raw[KEY.sessionUsage] || {};
        sessions[String(tabId)] = { host: request.host, limitId: request.limitId, url: request.url, limitSeconds: minutes * 60, usedSeconds: 0, expired: false };
        delete pending[String(tabId)];
        await chrome.storage.local.set({ [KEY.sessionUsage]: sessions, [KEY.pendingSessions]: pending });
        await chrome.tabs.update(tabId, { url: request.url });
        return { ok: true };
      }

      case "removeUsageLimit": {
        const state = await loadState();
        await commitBlocking(removeUsageLimit(state, msg.id), "remove-usage-limit");
        return { ok: true };
      }

      /** Explicit, expiring pause: the engine re-blocks when it lapses. */
      case "unblockRule": {
        const state = await loadState();
        if (!state.rules.some((r) => r.id === msg.id) && !state.usageLimits.some((r) => r.id === msg.id)) return { ok: false, error: "Unknown rule" };
        await saveState(unblockUntil(state, msg.id, msg.minutes ?? state.settings.tempUnblockMinutes));
        await syncRules("temp-unblock");
        return { ok: true };
      }

      case "blockPageUnblock": {
        const tabId = Number(_sender?.tab?.id);
        const host = normalizeHost(msg.host);
        if (!_sender?.url?.startsWith(chrome.runtime.getURL("blocked.html"))) return { ok: false, error: "This action is only available from North's block page." };
        const state = await loadState();
        const rule = [...state.rules, ...state.usageLimits].find((item) => item.id === msg.id && item.kind !== "app" && hostMatches(item.target, host));
        if (!Number.isInteger(tabId) || !rule) return { ok: false, error: "This block request is no longer available." };
        const verdict = evaluateBlocking(state, Date.now(), await currentUsageSeconds());
        if (!verdict.reasons[rule.id]) return { ok: false, error: "This site is no longer blocked." };
        await saveState(unblockUntil(state, rule.id, 1));
        await syncRules("block-page-one-minute");
        await chrome.tabs.update(tabId, { url: `https://${host}/` });
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
        await commitBlocking(upsertSchedule(state, sched), "add-schedule");
        return { ok: true, id: sched.id };
      }

      case "removeSchedule": {
        const state = await loadState();
        await commitBlocking(removeSchedule(state, msg.id), "remove-schedule");
        return { ok: true };
      }

      case "setScheduleEnabled": {
        const state = await loadState();
        const sc = state.schedules.find((s) => s.id === msg.id);
        if (!sc) return { ok: false, error: "Unknown schedule" };
        await commitBlocking(upsertSchedule(state, { ...sc, enabled: !!msg.enabled }), "toggle-schedule");
        return { ok: true };
      }

      case "startFocus":
        return { ok: true, focus: await startFocusSession(Number(msg.minutes) || 25) };

      case "cancelFocus":
        await endFocusSession();
        return { ok: true };

      case "linkAccount": {
        const un = String(msg.un || "").trim().toLowerCase();
        if (!un) return { ok: false, error: "Enter the username from the web app" };
        await chrome.storage.local.set({ [KEY.account]: { un, linkedAt: Date.now() } });
        return { ok: true, account: { un, linkedAt: Date.now() } };
      }

      case "unlinkAccount": {
        // A placeholder unlink is local; a real sign-out also revokes the
        // session and clears what the account synced down.
        const { [KEY.account]: current } = await chrome.storage.local.get(KEY.account);
        if (current?.authUserId) await onSignOutCleanup();
        await chrome.storage.local.remove(KEY.account);
        return { ok: true };
      }

      case "authSignOut": {
        await northAuth.signOut();
        await onSignOutCleanup();
        await chrome.storage.local.remove(KEY.account);
        return { ok: true };
      }

      case "authStatus": {
        const user = await northAuth.getSessionUser();
        return { ok: true, authed: Boolean(user), email: user?.email ?? null, configured: northAuth.isConfigured() };
      }

      case "authSetConfig": {
        try {
          const live = await northAuth.setConfig(msg.url, msg.anonKey, msg.webUrl);
          return { ok: true, live };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      }

      /** Manual "sync now" from the popup, and the web page's "north-sync". */
      case "syncAccount":
        await syncUsage();
        { const result = await syncAccount(); await syncRules('manual-refresh'); return result; }

      case "focusRank": {
        const ctx = await authContext();
        if (!ctx) return { ok: false, reason: 'signed_out' };
        const rows = await postgrest('/rpc/focus_rankings', { method: 'POST', body: { limit_count: 3 }, jwt: ctx.jwt, url: ctx.url, anonKey: ctx.anonKey });
        return { ok: true, mine: (rows || []).find(row => row.un === ctx.account.un) || null, rows };
      }

      default:
        return { ok: false, error: "unknown message" };
    }
  })().then(sendResponse).catch(error => sendResponse({ ok: false, reason: 'sync_failed', error: error.message || 'Sync could not finish. Please retry.' }));
  return true; // async response
});

// ── the North website's channel (externally_connectable) ──────────────────
/**
 * A North page can bootstrap the extension with its public auth config, ask for
 * a rule re-sync, extension status, or local daily usage aggregates. Which
 * messages are allowed, and from which origins, is
 * decided by lib/external.js — a pure function with its own tests — so this
 * listener carries no policy of its own.
 *
 * No website message edits individual rules. The only account-changing action
 * is a nonce-bound handoff after the user initiates Connect in the extension.
 */
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const verdict = externalAction(msg, sender?.origin);
  if (!verdict.ok) {
    sendResponse({ ok: false, error: verdict.error });
    return false;
  }
  (async () => {
    if (sender?.origin) await chrome.storage.local.set({ northWebUrl: sender.origin });
    if (verdict.action === "usage") await bumpUsage();
    const version = chrome.runtime.getManifest().version;
    if (verdict.action === "connect") {
      const { northConnectPending: pending } = await chrome.storage.local.get("northConnectPending");
      const nonce = String(msg.nonce || "");
      if (!pending || pending.nonce !== nonce || consumedConnectNonces.has(nonce) || pending.origin !== sender.origin || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now() || msg.extensionId !== chrome.runtime.id) {
        sendResponse({ ok: false, error: "This connect request expired or was not started by this extension. Try Connect to North again." });
        return;
      }
      // Consume before network or auth operations: a callback can never replay.
      consumedConnectNonces.add(nonce);
      await chrome.storage.local.remove("northConnectPending");
      await authReady;
      const { [KEY.account]: previous } = await chrome.storage.local.get(KEY.account);
      await northAuth.setConfig(msg.url, msg.anonKey, sender.origin);
      const user = await northAuth.adoptSession(msg.session);
      if (previous?.authUserId && previous.authUserId !== user.id) await onSignOutCleanup();
      const account = {
        un: String(user.email || "north-user").split("@")[0].toLowerCase(),
        linkedAt: Date.now(),
        authUserId: user.id,
        email: user.email || null,
      };
      await chrome.storage.local.set({ [KEY.account]: account, northWebUrl: sender.origin });
      // Keep the web page waiting until initial reconciliation finishes. A
      // paired account is not the same thing as a successful data sync.
      const synced = await syncAccount();
      if (synced.ok) {
        await syncUsage().catch((error) => console.debug("[north] usage sync after connect failed:", error?.message || error));
        await syncRules("account-connect").catch((error) => console.debug("[north] rules apply after connect failed:", error?.message || error));
      }
      sendResponse({ ok: true, email: user.email, version, synced: synced.ok, reason: synced.reason || null });
      return;
    }
    if (verdict.action === "sync") {
      // "A rule changed" / "Focus Mode started": reconcile now rather than at
      // the next tick, so the change is enforced on the next navigation.
      // A web message can be the first thing that wakes this MV3 worker. Wait
      // for GoTrue to restore its persisted session before reading auth state.
      await authReady;
      await syncUsage();
      const synced = await syncAccount();
      await syncRules("web-request");
      sendResponse({ ok: true, version, synced: synced.ok, reason: synced.reason || null });
      return;
    }
    const state = await loadState();
    const now = Date.now();
    const v = evaluateBlocking(state, now, await currentUsageSeconds());
    const [{ [KEY.account]: account }, { [KEY.usage]: usage = {} }, { [KEY.blocks]: blocks = {} }] = await Promise.all([
      chrome.storage.local.get(KEY.account),
      chrome.storage.local.get(KEY.usage),
      chrome.storage.local.get(KEY.blocks),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const usageToday = Object.entries(usage[today] || {})
      .map(([host, seconds]) => ({ host, seconds: Math.floor(seconds), minutes: Math.round(seconds / 60) }))
      .sort((a, b) => b.seconds - a.seconds);
    const blockedToday = Object.entries(blocks[today] || {})
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
    const usageLimits = state.usageLimits.filter((limit) => limit.kind === "website").map((limit) => {
      if (limit.mode === "session") return { ...limit, usedSeconds: 0, reached: false };
      const usedSeconds = Object.entries(usage[today] || {}).reduce((total, [host, seconds]) =>
        total + (hostMatches(limit.target, host) ? Number(seconds) || 0 : 0), 0);
      return { target: limit.target, dailyLimitMinutes: limit.dailyLimitMinutes, usedSeconds: Math.floor(usedSeconds), reached: usedSeconds >= limit.dailyLimitMinutes * 60 };
    });
    sendResponse(verdict.action === "usage"
      ? { ok: true, usageToday, blockedToday, usageLimits, accountId: account?.authUserId || null,
          usageDeviceId: await usageDeviceId(),
          hourlyToday: ((await chrome.storage.local.get(KEY.hourlyUsage))[KEY.hourlyUsage] || {})[today] || {} }
      : {
          ok: true, version,
          signedIn: Boolean(account?.authUserId),
          blocking: v.websites.length,
          focus: v.focus.active,
          focusEndsAt: v.focus.active ? v.focus.endsAt : null,
        });
  })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

// Keep the running tab's clock honest and the verdict fresh from the start.
chrome.alarms.create(ALARMS.usageFlush, { periodInMinutes: .5 });
loadState().then(() => syncRules("boot"));
// Signed in from a previous run: reconcile with the account as soon as the
// session is restored (the authReady promise above resolves first).
authReady.then(async (live) => {
  if (!live) return;
  const { [KEY.account]: account } = await chrome.storage.local.get(KEY.account);
  if (account?.authUserId) {
    await syncAccount().catch(() => {});
    await syncUsage().catch(() => {});
  }
});
