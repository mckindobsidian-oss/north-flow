/**
 * NORTH — blocking engine + account mapper tests.
 *
 * These run in plain Node (no DOM, no extension, no React) because the module
 * under test is pure. One suite therefore covers the logic of all four
 * clients — which is the whole point of sharing the engine.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHost,
  normalizeApp,
  normalizeTime,
  defaultBlocking,
  normalizeState,
  newRule,
  newSchedule,
  isScheduleActive,
  startFocus,
  evaluateBlocking,
  activeSchedules,
  unblockUntil,
  isTemporarilyUnblocked,
  migrateLegacy,
  removeSchedule,
  upsertRule,
  upsertSchedule,
  rulesByKind,
  describeBlocking,
  nextTransitionAt,
  msUntilBoundary,
  CLIENT_CAPABILITIES,
} from "../packages/shared-types/blocking.js";

import {
  toAppUser,
  defaultProfile,
  hydrateProfile,
  usernameFromEmail,
  slugUsername,
  displayName,
  initial,
} from "../packages/shared-types/account.js";

import { runSync } from "../scripts/sync-shared.mjs";

// ── helpers ───────────────────────────────────────────────────────────────
/** A local date at a given time, so tests never depend on the host clock. */
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

/** Local "YYYY-MM-DD" — used only for readable failure messages. */
const stamp = (y, m, d, h = 12, min = 0) => `${y}-${m}-${d} ${h}:${min}`;

// 2026-09-14 is a Monday (2026-09-19, "today", is a Saturday).
const MON = at(2026, 9, 14, 10, 0);
const MON_DAY = new Date(MON).getDay();

// ══════════════════════════════════════════════════════════════════════════
// normalization
// ══════════════════════════════════════════════════════════════════════════
test("normalizeHost reduces anything a human types to a bare hostname", () => {
  const cases = [
    ["https://www.YouTube.com/watch?v=1", "youtube.com"],
    ["  INSTAGRAM.com/ ", "instagram.com"],
    ["http://sub.example.co.uk:8443/a/b?c#d", "sub.example.co.uk"],
    ["user:pw@example.com", "example.com"],
    ["www.example.com.", "example.com"],
    ["reddit.com", "reddit.com"],
    ["localhost", "localhost"],
  ];
  for (const [input, want] of cases) {
    assert.equal(normalizeHost(input), want, `${input} → ${want}`);
  }
});

test("normalizeHost rejects what could never match a real host", () => {
  for (const bad of ["", "   ", "youtube", "has space.com", "http://", "..", "-"]) {
    assert.equal(normalizeHost(bad), "", JSON.stringify(bad));
  }
});

test("normalizeApp keeps display case but collapses whitespace", () => {
  assert.equal(normalizeApp("  Adobe   Photoshop "), "Adobe Photoshop");
  assert.equal(normalizeApp(undefined), "");
});

test("normalizeTime repairs loose input and falls back when unusable", () => {
  assert.equal(normalizeTime("9:5", "00:00"), "09:05");
  assert.equal(normalizeTime("23:59", "00:00"), "23:59");
  assert.equal(normalizeTime("25:00", "08:00"), "08:00");
  assert.equal(normalizeTime("noon", "08:00"), "08:00");
});

test("normalizeState repairs partial and junk state instead of throwing", () => {
  const s = normalizeState({
    rules: [{ kind: "website", target: "https://WWW.youtube.com/x" }, { kind: "website", target: "" }],
    schedules: [{ days: [1, 9, "x"], start: "8:0", end: "17:00" }],
    settings: { tempUnblockMinutes: 7 },
    unblocks: { keep: 123, drop: "soon" },
  });
  assert.equal(s.rules.length, 1, "unusable rule dropped");
  assert.equal(s.rules[0].target, "youtube.com");
  assert.equal(s.rules[0].when, "always", "default when");
  assert.deepEqual(s.schedules[0].days, [1], "out-of-range days removed");
  assert.equal(s.schedules[0].start, "08:00");
  assert.equal(s.settings.tempUnblockMinutes, 7, "user setting preserved");
  assert.equal(s.settings.allowTemporaryUnblock, true, "default filled in");
  assert.deepEqual(s.unblocks, { keep: 123 });
  assert.equal(normalizeState(null).version, 2);
});

// ══════════════════════════════════════════════════════════════════════════
// schedules
// ══════════════════════════════════════════════════════════════════════════
test("isScheduleActive respects the day of week and the window", () => {
  const sc = newSchedule({ days: [MON_DAY], start: "09:00", end: "17:00" });
  assert.equal(isScheduleActive(sc, MON), true, stamp(2026, 9, 14, 10, 0));
  assert.equal(isScheduleActive(sc, at(2026, 9, 14, 8, 59)), false, "before the window");
  assert.equal(isScheduleActive(sc, at(2026, 9, 14, 17, 0)), false, "end is exclusive");
  assert.equal(isScheduleActive(sc, at(2026, 9, 15, 10, 0)), false, "next day");
  assert.equal(isScheduleActive({ ...sc, enabled: false }, MON), false, "disabled");
});

test("a cross-midnight window belongs to its start day", () => {
  const sc = newSchedule({ days: [MON_DAY], start: "22:00", end: "06:00" });
  assert.equal(isScheduleActive(sc, at(2026, 9, 14, 23, 0)), true, "Monday night");
  assert.equal(isScheduleActive(sc, at(2026, 9, 15, 2, 0)), true, "Tuesday 02:00 = Monday's window");
  assert.equal(isScheduleActive(sc, at(2026, 9, 15, 7, 0)), false, "after the window");
  assert.equal(isScheduleActive(sc, at(2026, 9, 14, 12, 0)), false, "Monday midday");
  assert.equal(isScheduleActive(sc, at(2026, 9, 16, 2, 0)), false, "Wednesday 02:00 = Tuesday, not scheduled");
});

test("a zero-length window never blocks (a typo cannot hold someone 24/7)", () => {
  const sc = newSchedule({ days: [MON_DAY], start: "09:00", end: "09:00" });
  assert.equal(isScheduleActive(sc, MON), false);
  assert.equal(isScheduleActive(sc, at(2026, 9, 14, 9, 0)), false);
});

// ══════════════════════════════════════════════════════════════════════════
// the verdict
// ══════════════════════════════════════════════════════════════════════════
test("an always-on rule blocks at any hour, on every client's half", () => {
  const state = {
    ...defaultBlocking(),
    rules: [
      newRule({ kind: "website", target: "youtube.com" }),
      newRule({ kind: "app", target: "Instagram" }),
    ],
  };
  const v = evaluateBlocking(state, MON);
  assert.equal(v.active, true);
  assert.deepEqual(v.websites, ["youtube.com"]);
  assert.deepEqual(v.apps, ["instagram"], "app match key is lowercase");
  assert.deepEqual(v.appLabels, ["Instagram"], "display name preserved");
  assert.equal(v.reasons[state.rules[0].id].reason, "always");
});

test("a focus rule blocks only while a session is running", () => {
  const focusRule = newRule({ kind: "website", target: "twitter.com", when: "focus" });
  const idle = { ...defaultBlocking(), rules: [focusRule] };
  assert.equal(evaluateBlocking(idle, MON).active, false, "idle");

  const running = { ...idle, focus: startFocus(25, MON) };
  const v = evaluateBlocking(running, MON + 60_000);
  assert.equal(v.active, true);
  assert.deepEqual(v.websites, ["twitter.com"]);
  assert.equal(v.reasons[focusRule.id].reason, "focus");
  assert.equal(v.focus.active, true);
  assert.equal(v.focus.minutesLeft, 24);

  // The session ends on its own — no cleanup call required.
  assert.equal(evaluateBlocking(running, MON + 26 * 60_000).active, false, "after end");
});

test("blockDuringFocus=false turns off focus-tier rules only", () => {
  const state = {
    ...defaultBlocking(),
    settings: { ...defaultBlocking().settings, blockDuringFocus: false },
    rules: [
      newRule({ kind: "website", target: "twitter.com", when: "focus" }),
      newRule({ kind: "website", target: "youtube.com", when: "always" }),
    ],
    focus: startFocus(25, MON),
  };
  const v = evaluateBlocking(state, MON + 1000);
  assert.deepEqual(v.websites, ["youtube.com"]);
  assert.equal(v.focus.active, true, "the session still runs, it just doesn't block");
});

test("a scheduled rule follows its window and names its reason", () => {
  const sc = newSchedule({ name: "Work hours", days: [MON_DAY], start: "09:00", end: "17:00" });
  const rule = newRule({ kind: "website", target: "reddit.com", when: "scheduled", scheduleIds: [sc.id] });
  const state = upsertSchedule({ ...defaultBlocking(), rules: [rule] }, sc);

  const during = evaluateBlocking(state, MON);
  assert.deepEqual(during.websites, ["reddit.com"]);
  assert.equal(during.reasons[rule.id].reason, "schedule:Work hours");
  assert.deepEqual(during.schedules, [{ id: sc.id, name: "Work hours", end: "17:00" }]);

  assert.deepEqual(evaluateBlocking(state, at(2026, 9, 14, 20, 0)).websites, [], "after hours");
});

test("a scheduled rule with no scheduleIds follows any running schedule", () => {
  const sc = newSchedule({ name: "Evening", days: [MON_DAY], start: "18:00", end: "20:00" });
  const rule = newRule({ kind: "website", target: "twitch.tv", when: "scheduled" });
  const state = upsertSchedule({ ...defaultBlocking(), rules: [rule] }, sc);
  assert.deepEqual(evaluateBlocking(state, at(2026, 9, 14, 19, 0)).websites, ["twitch.tv"]);
  assert.deepEqual(evaluateBlocking(state, MON).websites, []);
});

test("a temporary unblock wins, then expires back into blocking", () => {
  const rule = newRule({ kind: "website", target: "youtube.com" });
  const state = { ...defaultBlocking(), rules: [rule] };
  const lifted = unblockUntil(state, rule.id, 5, MON);

  const now = MON + 60_000;
  const v = evaluateBlocking(lifted, now);
  assert.equal(v.active, false);
  assert.equal(v.reasons[rule.id].reason, "temp-unblock");
  assert.equal(v.reasons[rule.id].until, MON + 5 * 60_000);
  assert.equal(isTemporarilyUnblocked(lifted, rule.id, now), true);

  assert.equal(evaluateBlocking(lifted, MON + 6 * 60_000).active, true, "expired → blocked again");
  assert.equal(isTemporarilyUnblocked(lifted, rule.id, MON + 6 * 60_000), false);
});

test("a disabled rule is inert", () => {
  const rule = { ...newRule({ kind: "website", target: "youtube.com" }), enabled: false };
  assert.equal(evaluateBlocking({ ...defaultBlocking(), rules: [rule] }, MON).active, false);
});

test("activeSchedules reports exactly the running, enabled windows", () => {
  const a = newSchedule({ name: "A", days: [MON_DAY], start: "09:00", end: "17:00" });
  const b = newSchedule({ name: "B", days: [MON_DAY], start: "23:00", end: "23:30" });
  const c = newSchedule({ name: "C", days: [MON_DAY], start: "09:00", end: "17:00", enabled: false });
  const names = activeSchedules({ ...defaultBlocking(), schedules: [a, b, c] }, MON).map((s) => s.name);
  assert.deepEqual(names, ["A"]);
});

// ══════════════════════════════════════════════════════════════════════════
// editing + migration
// ══════════════════════════════════════════════════════════════════════════
test("legacy setups migrate without losing what the user had", () => {
  const state = migrateLegacy({
    blockedSites: ["youtube.com", "https://WWW.reddit.com/", "youtube.com"],
    trackedApps: [
      { name: "Instagram", blocked: true },
      { name: "YouTube", blocked: false },
    ],
    blockedApps: ["Games"],
    settings: { tempUnblockMinutes: 10 },
  });
  const v = evaluateBlocking(state, MON);
  assert.deepEqual(v.websites.sort(), ["reddit.com", "youtube.com"], "deduped + normalized");
  assert.deepEqual(v.apps.sort(), ["games", "instagram"], "only formerly-blocked apps");
  assert.equal(state.settings.tempUnblockMinutes, 10, "settings carried over");
});

test("removing a schedule drops dangling rule references", () => {
  const sc = newSchedule({ name: "Work", days: [MON_DAY] });
  const rule = newRule({ kind: "website", target: "reddit.com", when: "scheduled", scheduleIds: [sc.id] });
  const withBoth = upsertSchedule({ ...defaultBlocking(), rules: [rule] }, sc);
  const after = removeSchedule(withBoth, sc.id);
  assert.deepEqual(after.rules[0].scheduleIds, [], "reference cleared");
  assert.deepEqual(evaluateBlocking(after, MON).websites, [], "and it no longer blocks");
});

test("upsertRule replaces rather than duplicating", () => {
  const rule = newRule({ kind: "website", target: "a.com" });
  let s = upsertRule(defaultBlocking(), rule);
  s = upsertRule(s, { ...rule, target: "b.com" });
  assert.equal(s.rules.length, 1);
  assert.equal(s.rules[0].target, "b.com");
});

test("rulesByKind labels rules for the UI", () => {
  const sc = newSchedule({ name: "Work", days: [MON_DAY] });
  const state = upsertSchedule(
    {
      ...defaultBlocking(),
      rules: [
        newRule({ kind: "website", target: "youtube.com" }),
        newRule({ kind: "app", target: "Games", when: "focus" }),
        newRule({ kind: "website", target: "reddit.com", when: "scheduled", scheduleIds: [sc.id] }),
      ],
    },
    sc
  );
  const g = rulesByKind(state);
  assert.equal(g.websites.length, 2);
  assert.equal(g.apps.length, 1);
  assert.equal(g.websites.find((r) => r.target === "reddit.com").whenLabel, "Scheduled: Work");
  assert.equal(g.apps[0].whenLabel, "During focus");
});

// ══════════════════════════════════════════════════════════════════════════
// timing / status text
// ══════════════════════════════════════════════════════════════════════════
test("nextTransitionAt finds the next schedule edge and ignores the past", () => {
  const sc = newSchedule({ days: [MON_DAY], start: "09:00", end: "17:00" });
  const state = upsertSchedule(defaultBlocking(), sc);

  const before = nextTransitionAt(state, at(2026, 9, 14, 8, 0));
  assert.equal(new Date(before).getHours(), 9, "next thing is the window opening");
  const during = nextTransitionAt(state, at(2026, 9, 14, 10, 0));
  assert.equal(new Date(during).getHours(), 17, "inside the window, next thing is closing");
  assert.equal(nextTransitionAt(defaultBlocking(), MON), null, "no schedules → nothing ahead");
});

test("msUntilBoundary is capped so a worker cannot sleep through a change", () => {
  const sc = newSchedule({ days: [MON_DAY], start: "09:00", end: "17:00" });
  const state = upsertSchedule(defaultBlocking(), sc);
  assert.equal(msUntilBoundary(state, at(2026, 9, 14, 8, 0)), 60 * 60 * 1000, "capped at 1h");
  assert.equal(msUntilBoundary(state, at(2026, 9, 14, 16, 59)), 60 * 1000, "1 minute to close");
  assert.equal(msUntilBoundary(defaultBlocking(), MON), null, "nothing scheduled");
});

test("describeBlocking says what is blocked and why, without overclaiming", () => {
  const rule = newRule({ kind: "website", target: "youtube.com" });
  const blocked = describeBlocking({ ...defaultBlocking(), rules: [rule] }, MON);
  assert.equal(blocked.active, true);
  assert.match(blocked.headline, /Blocking 1 site/);
  assert.match(blocked.detail, /always-on rules/);

  const empty = describeBlocking(defaultBlocking(), MON);
  assert.equal(empty.active, false);
  assert.match(empty.headline, /Nothing to block yet/);
});

test("capability table never claims the web or mobile can enforce", () => {
  assert.equal(CLIENT_CAPABILITIES.web.enforceWebsites, false);
  assert.equal(CLIENT_CAPABILITIES.web.enforceApps, false);
  assert.equal(CLIENT_CAPABILITIES.mobile.enforceApps, false);
  assert.equal(CLIENT_CAPABILITIES.extension.enforceWebsites, true);
  assert.equal(CLIENT_CAPABILITIES.extension.enforceApps, false);
  assert.equal(CLIENT_CAPABILITIES.desktop.enforceApps, true);
  assert.equal(CLIENT_CAPABILITIES.desktop.enforceWebsites, false);
  for (const c of Object.values(CLIENT_CAPABILITIES)) assert.ok(c.note && c.configure);
});

// ══════════════════════════════════════════════════════════════════════════
// account mapping — the regression that made login crash
// ══════════════════════════════════════════════════════════════════════════
test("toAppUser turns a Supabase user into an app user with a usable key", () => {
  const su = { id: "abc-123", email: "Aarav.Sharma@example.com", user_metadata: { name: "Aarav Sharma" } };
  const u = toAppUser(su, null);
  assert.equal(u.un, "aarav.sharma", "username derived from the email");
  assert.equal(u.name, "Aarav Sharma", "display name from Supabase metadata");
  assert.equal(u.id, "abc-123");
  assert.equal(u.authLinked, true);
  assert.equal(u.hasProfile, false, "caller knows to create the profile");
  // Every screen reads these — the old bug was both being undefined.
  assert.ok(u.un && u.name);
  assert.equal(initial(u), "A");
});

test("an existing profile wins for data, Supabase for identity", () => {
  const profile = { ...defaultProfile({ un: "aarav", name: "Aarav S" }), tasks: [{ id: "t1" }], pm: { w: 50 } };
  const u = toAppUser({ id: "abc", email: "someone-else@example.com", user_metadata: { name: "Other" } }, profile);
  assert.equal(u.un, "aarav", "the profile's key is stable across devices");
  assert.equal(u.name, "Aarav S");
  assert.deepEqual(u.tasks, [{ id: "t1" }], "profile data preserved");
  assert.equal(u.authLinked, true);
  assert.equal(u.hasProfile, true);
});

test("with no Supabase configured the device record still works", () => {
  const u = toAppUser(null, defaultProfile({ un: "demo", name: "Aarav" }));
  assert.equal(u.un, "demo");
  assert.equal(u.authLinked, false, "honest: not vouched for by the account service");
});

test("usernameFromEmail and slugUsername always produce a safe key", () => {
  assert.equal(usernameFromEmail("A.B+C@x.com"), "a.bc", "+tag dropped, dots are legal in a username");
  assert.equal(usernameFromEmail("", "9f8e7d6c-1111"), "user_9f8e7d6c");
  assert.equal(usernameFromEmail("", ""), "user");
  assert.equal(slugUsername("  --Weird Name!!  "), "weirdname");
  assert.equal(slugUsername("x".repeat(50)).length, 20, "bounded length");
});

test("hydrateProfile upgrades a legacy record and adds blocking state", () => {
  const legacy = { un: "aarav", name: "Aarav", apps: [{ id: "a1", name: "Instagram", blocked: true }] };
  const p = hydrateProfile(legacy, { un: "aarav", migrate: (o) => migrateLegacy(o) });
  assert.ok(p.blocking, "blocking state added");
  // App targets keep the user's display case; matching lowercases at compare time.
  assert.deepEqual(p.blocking.rules.map((r) => r.target), ["Instagram"], "existing block carried over");
  assert.deepEqual(evaluateBlocking(p.blocking, MON).apps, ["instagram"]);
  assert.deepEqual(p.tasks, []);
  assert.equal(p.pm.w, 25, "pomodoro defaults filled in");
  assert.equal(hydrateProfile(null), null);
});

// ══════════════════════════════════════════════════════════════════════════
// the vendored copies are the canonical modules
// ══════════════════════════════════════════════════════════════════════════
test("every client's copy of the shared modules is in sync", () => {
  const stale = runSync({ check: true });
  assert.deepEqual(stale, [], `run: npm run sync:shared\n${stale.join("\n")}`);
});
