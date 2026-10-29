/**
 * NORTH — browser extension tests (pure half).
 *
 * The extension's job is enforcement, and enforcement is the one place where a
 * wrong answer is invisible: a rule that over-matches blocks a site the user
 * never listed, and a rule that under-matches silently does nothing while the
 * UI claims it is enforcing. So the whole decision layer of the extension is
 * pure (no `chrome.*`) and covered here:
 *
 *   lib/dnr.js           which browser rules should exist, and what matches
 *   lib/account-merge.js how the account's rules and Focus Mode reach the device
 *   lib/block-reason.js  the words on the block page
 *   lib/external.js      what a web page is allowed to ask the extension
 *
 *   npm test
 *
 * What is NOT covered here, and cannot be: that Chrome obeys the rules we
 * generate. That is verified separately, against a real Chromium browser —
 * see `scripts/verify-extension.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ruleIdFor,
  filterFor,
  hostMatches,
  matchForHost,
  assignRuleIds,
  buildBlockRule,
  planRules,
  isOurRuleId,
  RULE_ID_MIN,
  RULE_ID_MAX,
} from "../apps/extension/lib/dnr.js";

import {
  applyAccountBlocking,
  adoptFocus,
  blockingToSettings,
  FOCUS_SOURCE,
} from "../apps/extension/lib/account-merge.js";

import {
  encodeReason,
  scheduleNames,
  describeBlock,
  parseBlockParams,
  blockPageUrl,
} from "../apps/extension/lib/block-reason.js";

import { externalAction, isTrustedOrigin, NORTH_WEB_ORIGINS } from "../apps/extension/lib/external.js";
import { validateProjectConfig } from "../apps/extension/lib/north-auth.js";
import { connectExtensionAccount } from "../react-app/src/lib/extension.js";
import { aggregateUsageRange, splitUsageInterval, selectUsageTabs, httpHost, summarizeDesktopUsage } from "../apps/extension/lib/usage.js";

test("synced desktop usage combines collectors without duplicating the legacy total", () => {
  assert.deepEqual(summarizeDesktopUsage([
    { kind: "app", name: "notepad", seconds: 20, device_id: "desktop-a" },
    { kind: "app", name: "notepad", seconds: 30, device_id: "desktop-b" },
    { kind: "app", name: "notepad", seconds: 40, device_id: "legacy" },
    { kind: "website", name: "example.com", seconds: 100 },
  ]), [{ name: "notepad", seconds: 50 }]);
});

test("tracking excludes internal pages and preserves frequent fractional samples", () => {
  for (const url of ["chrome://extensions", "brave://newtab", "chrome-extension://abcdefghijklmnop/popup.html", "about:blank", "file:///private.txt"]) assert.equal(httpHost(url), null);
  assert.equal(httpHost("https://www.example.com/page"), "example.com");
  const start = Date.parse("2026-10-21T12:00:00Z");
  const samples = Array.from({ length: 5 }, (_, index) => splitUsageInterval("example.com", start + index * 250, start + (index + 1) * 250));
  assert.equal(samples.flat().reduce((sum, row) => sum + row.seconds, 0), 1.25);
});

import { readFileSync } from "node:fs";
import { createHash, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "extension");
const read = (p) => readFileSync(resolve(EXT, p), "utf8");
const { docFromProfile } = await import("../react-app/src/lib/sync-map.js");

import {
  normalizeState,
  defaultBlocking,
  newRule,
  newSchedule,
  startFocus,
  upsertUsageLimit,
} from "../packages/shared-types/blocking.js";

const at = (h, m = 0) => new Date(2026, 8, 14, h, m, 0, 0).getTime(); // Mon 14 Sep 2026

// ── domain matching ───────────────────────────────────────────────────────
test("a blocked domain matches itself and every subdomain", () => {
  for (const host of ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "a.b.youtube.com"]) {
    assert.equal(hostMatches("youtube.com", host), true, host);
  }
});

test("similar domains are NOT matched (no naive substring matching)", () => {
  const blocked = "youtube.com";
  for (const host of [
    "notyoutube.com",       // the classic over-match
    "youtube-example.com",  // hyphen, not a label boundary
    "myyoutube.com",
    "youtube.com.evil.org", // the domain as a *prefix*, not the host
    "youtube.co",
    "youtubexcom",
    "youtube",
    "",
  ]) {
    assert.equal(hostMatches(blocked, host), false, host);
  }
});

test("matching ignores case, a leading www., and trailing dots", () => {
  assert.equal(hostMatches("YouTube.com", "WWW.YouTube.COM"), true);
  assert.equal(hostMatches("youtube.com.", "youtube.com"), true);
});

test("the generated filter is a domain anchor plus separator, not a substring", () => {
  assert.equal(filterFor("youtube.com"), "||youtube.com^");
  // The two anchors are the entire reason notyoutube.com is safe: `||` binds to
  // a domain boundary and `^` requires a separator after the domain.
  assert.equal(filterFor("notyoutube.com"), "||notyoutube.com^");
});

test("matchForHost reports which rule covers a page, from the engine's verdict", () => {
  const verdict = { websites: ["youtube.com", "instagram.com"] };
  assert.equal(matchForHost(verdict, "www.youtube.com"), "youtube.com");
  assert.equal(matchForHost(verdict, "instagram.com"), "instagram.com");
  assert.equal(matchForHost(verdict, "reddit.com"), null);
  assert.equal(matchForHost({ websites: [] }, "youtube.com"), null);
});

// ── rule generation and reconciliation ────────────────────────────────────
test("a generated rule blocks the navigation itself, in our own id band", () => {
  const rule = buildBlockRule("youtube.com");
  assert.equal(rule.action.type, "block");
  assert.equal(rule.condition.urlFilter, "||youtube.com^");
  assert.ok(rule.condition.resourceTypes.includes("main_frame"), "the page itself is blocked");
  assert.ok(isOurRuleId(rule.id), "inside the band the diff is allowed to touch");
  assert.ok(rule.id >= RULE_ID_MIN && rule.id < RULE_ID_MAX);
});

test("ids are stable per host, so one change does not rebuild the list", () => {
  assert.equal(ruleIdFor("youtube.com"), ruleIdFor("youtube.com"));
  assert.notEqual(ruleIdFor("youtube.com"), ruleIdFor("instagram.com"));

  // Adding a domain must leave every existing rule untouched.
  const before = planRules(["youtube.com"], []);
  const applied = before.addRules.map((r) => r.id);
  const after = planRules(["youtube.com", "reddit.com"], applied);
  assert.equal(after.addRules.length, 1, "only the new domain is added");
  assert.deepEqual(after.removeRuleIds, [], "nothing existing is removed");
});

test("multiple domains each get one rule, and duplicates collapse", () => {
  const { addRules, ids } = planRules(["youtube.com", "reddit.com", "instagram.com", "youtube.com"], []);
  assert.equal(addRules.length, 3);
  assert.equal(ids.size, 3, "a duplicate domain is one rule");
  assert.equal(new Set(addRules.map((r) => r.id)).size, 3, "ids are unique");
});

test("assignRuleIds resolves a collision instead of emitting duplicate ids", () => {
  // Collisions are astronomically unlikely, so they are forced: the second host
  // is placed on the id the first one holds, and must be probed elsewhere.
  const hosts = Array.from({ length: 500 }, (_, i) => `site${i}.example.com`);
  const ids = assignRuleIds(hosts);
  assert.equal(new Set(ids.values()).size, hosts.length, "every rule id is distinct");
});

test("an empty rule set removes everything it previously applied", () => {
  const applied = planRules(["youtube.com", "reddit.com"], []).addRules.map((r) => r.id);
  const { addRules, removeRuleIds, unchanged } = planRules([], applied);
  assert.deepEqual(addRules, []);
  assert.deepEqual(removeRuleIds.sort((a, b) => a - b), [...applied].sort((a, b) => a - b));
  assert.equal(unchanged, false);
});

test("removing one domain removes exactly its rule", () => {
  const ids = planRules(["youtube.com", "reddit.com"], []).addRules.map((r) => r.id);
  const { removeRuleIds, addRules } = planRules(["reddit.com"], ids);
  assert.deepEqual(removeRuleIds, [ruleIdFor("youtube.com")]);
  assert.deepEqual(addRules, [], "the surviving rule is not re-added");
});

test("an unchanged verdict produces no browser writes at all", () => {
  const ids = planRules(["youtube.com", "reddit.com"], []).addRules.map((r) => r.id);
  const plan = planRules(["reddit.com", "youtube.com"], ids); // different order
  assert.equal(plan.unchanged, true);
  assert.deepEqual(plan.addRules, []);
  assert.deepEqual(plan.removeRuleIds, []);
});

test("rules belonging to someone else are never touched", () => {
  // A rule another extension wrote sits at id 5; a manifest static rule at 1.
  const foreign = [1, 5, RULE_ID_MAX + 10];
  const { addRules, removeRuleIds } = planRules(["youtube.com"], foreign);
  assert.equal(addRules.length, 1);
  assert.deepEqual(removeRuleIds, [], "foreign and reserved ids stay put");
});

test("a browser restart re-derives the same rules from the same state", () => {
  // What "survives a restart" means for the worker: storage holds the rules,
  // and the first reconcile after waking rebuilds the browser half exactly.
  const state = normalizeState({
    ...defaultBlocking(),
    rules: [
      newRule({ kind: "website", target: "youtube.com" }),
      newRule({ kind: "website", target: "reddit.com" }),
      newRule({ kind: "website", target: "instagram.com" }),
    ],
  });
  const first = planRules(state.rules.map((r) => r.target), []);
  // A restart begins with the browser's rules still installed.
  const afterRestart = planRules(state.rules.map((r) => r.target), first.addRules.map((r) => r.id));
  assert.equal(afterRestart.unchanged, true);
});

// ── enabled / disabled ───────────────────────────────────────────────────
test("a disabled rule is not enforced, and turning it back on restores exactly it", () => {
  const on = newRule({ kind: "website", target: "youtube.com" });
  const off = { ...on, enabled: false };
  const state = normalizeState({ ...defaultBlocking(), rules: [on, off] });

  const blocked = state.rules.filter((r) => r.enabled).map((r) => r.target);
  assert.deepEqual(blocked, ["youtube.com"], "the disabled rule contributes nothing");

  const ids = planRules(blocked, []);
  const reEnabled = planRules(["youtube.com", "youtube.com"], ids.addRules.map((r) => r.id));
  assert.equal(reEnabled.unchanged, true, "re-enabling is idempotent");
});

// ── focus sessions ───────────────────────────────────────────────────────
test("a focus session published by the web app is adopted by the browser", () => {
  const local = normalizeState(
    { ...defaultBlocking(), rules: [newRule({ kind: "website", target: "youtube.com", when: "focus" })] }
  );
  const settings = {
    blocking: {
      rules: local.rules,
      schedules: [],
      settings: local.settings,
      focus: startFocus(25, at(9)),
    },
  };
  const { state, focusSource } = applyAccountBlocking(local, settings, { now: at(9) });
  assert.equal(state.focus.endAt, at(9) + 25 * 60000);
  assert.equal(focusSource, FOCUS_SOURCE.account, "the account's session is the authority");
});

test("a focus session that has ended stops blocking", () => {
  // The account publishes a 25-minute window starting at 09:00.
  const window25 = startFocus(25, at(9));
  const settings = { blocking: { rules: [], schedules: [], settings: {}, focus: window25 } };
  const local = normalizeState({ ...defaultBlocking(), focus: window25 });

  // Two minutes in, the same document is still a running session.
  const running = applyAccountBlocking(local, settings, { now: at(9, 2), focusSource: FOCUS_SOURCE.account });
  assert.equal(running.state.focus.endAt, window25.endAt, "still counting down");

  // Past the end the window is no longer live, so it is cleared — and that is
  // exactly what "Focus Mode ended" has to mean for website blocking.
  const expired = applyAccountBlocking(local, settings, { now: at(10), focusSource: FOCUS_SOURCE.account });
  assert.equal(expired.state.focus, null, "the session is over");
  assert.equal(expired.focusSource, null, "and this device no longer owns it");
});

test("an account pull cannot cancel a session started in this browser", () => {
  const local = normalizeState({ ...defaultBlocking(), focus: startFocus(50, at(9)) });
  const settings = { blocking: { rules: [], schedules: [], settings: {}, focus: null } };
  const { state } = applyAccountBlocking(local, settings, { now: at(9, 5), focusSource: FOCUS_SOURCE.local });
  assert.ok(state.focus, "a popup-started session survives");
  assert.equal(state.focus.endAt, at(9) + 50 * 60000);
});

test("the later of two running sessions wins, so nothing is cut short", () => {
  const local = normalizeState({ ...defaultBlocking(), focus: startFocus(50, at(9)) });
  const shorter = { blocking: { rules: [], schedules: [], settings: {}, focus: startFocus(10, at(9)) } };
  const a = applyAccountBlocking(local, shorter, { now: at(9, 1), focusSource: FOCUS_SOURCE.local });
  assert.equal(a.state.focus.endAt, at(9) + 50 * 60000, "the longer local session survives");

  const shortLocal = normalizeState({ ...defaultBlocking(), focus: startFocus(5, at(9)) });
  const longer = { blocking: { rules: [], schedules: [], settings: {}, focus: startFocus(90, at(9)) } };
  const b = applyAccountBlocking(shortLocal, longer, { now: at(9, 1), focusSource: FOCUS_SOURCE.local });
  assert.equal(b.state.focus.endAt, at(9) + 90 * 60000, "the longer account session is adopted");
  assert.equal(b.focusSource, FOCUS_SOURCE.account);
});

test("adoptFocus is a no-op when nothing is running and nothing arrived", () => {
  const local = normalizeState({ ...defaultBlocking(), focus: null });
  const { state, focusSource } = adoptFocus(local, {}, at(9), null);
  assert.equal(state.focus, null);
  assert.equal(focusSource, null);
});

// ── the temporary unblock stays on this device ───────────────────────────
test("a temporary unblock is never overwritten by an account pull", () => {
  const rule = newRule({ kind: "website", target: "youtube.com" });
  const local = normalizeState({
    ...defaultBlocking(),
    rules: [rule],
    unblocks: { [rule.id]: at(12) }, // paused until noon
  });
  const settings = { blocking: { rules: [rule], schedules: [], settings: {} } };
  const { state } = applyAccountBlocking(local, settings, { now: at(9) });
  assert.deepEqual(state.unblocks, { [rule.id]: at(12) }, "the local pause survives the pull");
});

test("nothing this device writes back ever publishes a focus window", () => {
  // One writer for the focus window (the web timer) is what makes Focus Mode
  // trustworthy; the extension would be a second, racing one.
  const state = normalizeState({ ...defaultBlocking(), focus: startFocus(25, at(9)) });
  const payload = blockingToSettings(state);
  assert.equal(payload.blocking.focus, undefined);
  assert.ok(Array.isArray(payload.blocking.rules));
  assert.equal(payload.blockDuringFocus, true);
});

test("website time limits survive account serialization and extension adoption", () => {
  const local = upsertUsageLimit(defaultBlocking(), { target: "youtube.com", dailyLimitMinutes: 30 });
  const payload = blockingToSettings(local);
  assert.equal(payload.blocking.usageLimits[0].dailyLimitMinutes, 30);
  const adopted = applyAccountBlocking(defaultBlocking(), payload).state;
  assert.equal(adopted.usageLimits[0].target, "youtube.com");
  assert.equal(adopted.usageLimits[0].dailyLimitMinutes, 30);
});

// ── failed sync / missing documents ──────────────────────────────────────
test("a profile with no blocking document changes nothing", () => {
  const local = normalizeState({ ...defaultBlocking(), rules: [newRule({ kind: "website", target: "youtube.com" })] });
  const { state } = applyAccountBlocking(local, {}, at(9));
  assert.deepEqual(state.rules.map((r) => r.target), ["youtube.com"], "rules are the user's; absence is not 'no rules'");
  assert.deepEqual(applyAccountBlocking(local, undefined, at(9)).state.rules.map((r) => r.target), ["youtube.com"]);
});

test("a malformed account document cannot empty the local rules", () => {
  const local = normalizeState({ ...defaultBlocking(), rules: [newRule({ kind: "website", target: "youtube.com" })] });
  // `rules` present but not an array: a half-written row must not be read as
  // "the user deleted everything".
  const { state } = applyAccountBlocking(local, { blocking: { rules: null } }, at(9));
  assert.equal(state.rules.length, 1);
});

test("a sync that never arrives leaves the last known rules in place", () => {
  // The offline story in one assertion: state comes from storage, so a failed
  // request changes nothing and blocking continues from the last good answer.
  const prior = normalizeState({ ...defaultBlocking(), rules: [newRule({ kind: "website", target: "youtube.com" })] });
  const afterFailedSync = normalizeState(prior);
  assert.deepEqual(planRules(afterFailedSync.rules.map((r) => r.target), []).addRules.length, 1);
});

test("schedules from the account survive the merge and still gate their rules", () => {
  const schedule = newSchedule({ name: "Work hours", days: [1], start: "09:00", end: "17:00" });
  const rule = newRule({ kind: "website", target: "reddit.com", when: "scheduled", scheduleIds: [schedule.id] });
  const settings = { blocking: { rules: [rule], schedules: [schedule], settings: {} } };
  const { state } = applyAccountBlocking(defaultBlocking(), settings, { now: at(10) });
  assert.equal(state.schedules.length, 1);
  assert.equal(state.rules[0].when, "scheduled");
});

test("the document the web app publishes is exactly the one the extension reads", () => {
  // The cross-client contract, end to end and in one place: sync-map.js writes
  // `profiles.settings.blocking`, and account-merge.js consumes it. If either
  // side renames a field, Focus Mode silently stops blocking in the browser — so
  // the two are joined here rather than only tested against themselves.
  const blocking = { ...defaultBlocking(), focus: startFocus(25, at(9)) };
  const doc = docFromProfile({ name: "Aarav", pm: {}, apps: [], blocking });

  const { state, focusSource } = applyAccountBlocking(
    defaultBlocking(),
    { blocking: doc.blocking, blockDuringFocus: true },
    { now: at(9, 5) }
  );
  assert.equal(state.focus.endAt, at(9) + 25 * 60000, "Focus Mode reached the browser");
  assert.equal(focusSource, FOCUS_SOURCE.account);

  // And rules travel with it, through the same document.
  const withRule = docFromProfile({
    name: "Aarav",
    blocking: { ...defaultBlocking(), rules: [newRule({ kind: "website", target: "youtube.com" })] },
  });
  const merged = applyAccountBlocking(defaultBlocking(), { blocking: withRule.blocking }, { now: at(9) });
  assert.deepEqual(merged.state.rules.map((r) => r.target), ["youtube.com"]);
});

// ── the block page ───────────────────────────────────────────────────────
test("the block page URL carries the domain and reason, and no identifiers", () => {
  const url = blockPageUrl("chrome-extension://abc/blocked.html", {
    domain: "youtube.com",
    code: "focus",
    minutesLeft: 18,
    ruleId: "block-123",
  });
  assert.match(url, /d=youtube\.com/);
  assert.match(url, /r=focus/);
  assert.match(url, /m=18/);
  assert.match(url, /i=block-123/);
  assert.ok(!/token|jwt|user/i.test(url), "no account identifiers travel in the URL");

  const parsed = parseBlockParams(url.slice(url.indexOf("?")));
  assert.deepEqual(parsed, { domain: "youtube.com", code: "focus", names: "", minutesLeft: 18, ruleId: "block-123" });
});

test("the engine's reason string maps to a code and, where relevant, keeps its schedule names", () => {
  assert.equal(encodeReason("always"), "always");
  assert.equal(encodeReason("focus"), "focus");
  assert.equal(encodeReason("schedule:Work hours"), "schedule");
  assert.equal(encodeReason("daily-limit"), "limit");
  assert.equal(scheduleNames("schedule:Work hours, Deep work"), "Work hours, Deep work");
});

test("each reason explains itself honestly, and Focus Mode reads as Focus Mode", () => {
  const focus = describeBlock({ code: "focus", domain: "youtube.com", minutesLeft: 12 });
  assert.equal(focus.tone, "focus");
  assert.equal(focus.badge, "Focus Mode");
  assert.match(focus.detail, /12 minutes left/);

  const sched = describeBlock({ code: "schedule", domain: "reddit.com", names: "Work hours" });
  assert.match(sched.detail, /Work hours/);

  const always = describeBlock({ code: "always", domain: "instagram.com" });
  assert.match(always.headline, /blocked by North Flow/);
  assert.match(always.detail, /instagram\.com/);
  assert.equal(describeBlock({ code: "limit", domain: "youtube.com" }).badge, "Limit reached");
});

test("an unknown or tampered reason code falls back rather than inventing one", () => {
  const parsed = parseBlockParams("?d=youtube.com&r=definitely-not-a-code&m=99999");
  assert.equal(parsed.code, "always");
  assert.equal(parsed.minutesLeft, 24 * 60, "a hand-written countdown is clamped");
  const bogus = describeBlock({ code: "nonsense", domain: "x.com" });
  assert.match(bogus.headline, /blocked by North Flow/);
});

// ── the UI and the worker must actually fit together ─────────────────────
//
// These two suites exist because of a real bug that shipped: popup.js assigned
// `$("acctUnlink").onclick`, there was no such element, and the throw took every
// handler below it with it — the account controls were simply dead, while the
// file looked fine. Nothing caught it, because nothing compared the two files.

const idsIn = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const idsUsed = (js) => [...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);

for (const [page, script] of [["popup.html", "popup.js"], ["blocked.html", "blocked.js"]]) {
  test(`every element ${script} reaches for exists in ${page}`, () => {
    const present = idsIn(read(page));
    const missing = [...new Set(idsUsed(read(script)))].filter((id) => !present.has(id));
    assert.deepEqual(missing, [], `${script} would throw on: ${missing.join(", ")}`);
  });
}

test("extension account UI exposes only the North website connection flow", () => {
  const html = read("popup.html");
  const js = read("popup.js");
  assert.match(html, /id="acctConnect"[^>]*>Connect to North/);
  for (const text of ["Continue with Google", "Sign in with email", "Email verification code", "Use a local name instead"]) {
    assert.ok(!html.includes(text), `obsolete extension login UI removed: ${text}`);
  }
  assert.ok(!js.includes('type: "authGoogleSignIn"'));
  assert.ok(!js.includes('type: "authSendEmailOtp"'));
});

test("every message the UI sends has a handler in the worker", () => {
  const worker = read("background.js");
  const handled = new Set([...worker.matchAll(/case "([a-zA-Z]+)":/g)].map((m) => m[1]));
  const sent = new Set(
    [...read("popup.js").matchAll(/send\(\{\s*type:\s*"([^"]+)"/g)].map((m) => m[1])
  );
  // The web app drives the third of these through the external channel.
  for (const type of ["north-ping", "north-sync", "north-focus", "north-usage", "north-connect"]) {
    assert.ok(read("lib/external.js").includes(`"${type}"`), `${type} is allowed by the policy`);
  }
  const unhandled = [...sent].filter((t) => !handled.has(t));
  assert.deepEqual(unhandled, [], `no handler for: ${unhandled.join(", ")}`);
  assert.ok(handled.has("getState"), "the popup's first call is handled");
});

test("the shipped manifest is valid JSON and asks for nothing exotic", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.background?.service_worker, "MV3 needs a service worker");
  // The block page is opened by the worker itself, so it must NOT be exposed to
  // ordinary web pages.
  assert.equal("web_accessible_resources" in m, false);
  // A pinned key is what lets the web app address the extension at all.
  assert.ok(typeof m.key === "string" && m.key.length > 100, "the id is pinned");
  const der = Buffer.from(m.key, "base64");
  createPublicKey({ key: der, format: "der", type: "spki" });
  const id = createHash("sha256").update(der).digest().subarray(0, 16).toString("hex")
    .replace(/[0-9a-f]/g, (n) => "abcdefghijklmnop"[parseInt(n, 16)]);
  assert.match(readFileSync(resolve(EXT, "../../react-app/src/lib/extension.js"), "utf8"), new RegExp(id));
  for (const origin of NORTH_WEB_ORIGINS) {
    assert.ok(
      (m.externally_connectable?.matches || []).some((p) => p.startsWith(origin)),
      `${origin} must be in externally_connectable`
    );
  }
});

// ── what a web page may ask for ──────────────────────────────────────────
for (const origin of NORTH_WEB_ORIGINS) {
  test(`a North origin is trusted: ${origin}`, () => {
    assert.equal(isTrustedOrigin(origin), true);
  });
}

test("any other origin is refused, including lookalikes and subdomains", () => {
  for (const origin of [
    "https://evil.example",
    "https://north.vercel.app",     // example domain is not this North deployment
    "http://localhost:3000",         // a different local app
    "https://north.vercel.app.evil.com",
    "https://evilnorth.vercel.app",
    "http://notlocalhost:5173",
    "",
    null,
  ]) {
    for (const type of ["north-sync", "north-usage", "north-connect"]) {
      const res = externalAction({ type }, origin);
      assert.equal(res.ok, false, `${origin} / ${type}`);
      assert.equal(res.error, "untrusted_origin", `${origin} / ${type}`);
    }
  }
});

test("a trusted page can check status, read daily usage, or request a re-sync", () => {
  const origin = NORTH_WEB_ORIGINS[0];
  assert.deepEqual(externalAction({ type: "north-ping" }, origin), { ok: true, action: "status" });
  assert.deepEqual(externalAction({ type: "north-sync" }, origin), { ok: true, action: "sync" });
  assert.deepEqual(externalAction({ type: "north-focus" }, origin), { ok: true, action: "sync" });
  assert.deepEqual(externalAction({ type: "north-usage" }, origin), { ok: true, action: "usage" });
  assert.deepEqual(externalAction({ type: "north-connect" }, origin), { ok: true, action: "connect" });
});

test("North extension accepts only a bare project URL and public key", () => {
  assert.deepEqual(validateProjectConfig("https://project.supabase.co/", "sb_publishable_public"), {
    url: "https://project.supabase.co", key: "sb_publishable_public",
  });
  assert.deepEqual(validateProjectConfig("http://localhost:54321", "public-local-key"), {
    url: "http://localhost:54321", key: "public-local-key",
  });
  for (const [url, key] of [
    ["https://project.supabase.co/rest/v1", "public-key"],
    ["http://remote.example", "public-key"],
    ["https://project.supabase.co", "sb_secret_not-public"],
    ["https://project.supabase.co", "service_role"],
  ]) assert.throws(() => validateProjectConfig(url, key));
  assert.match(readFileSync(resolve(EXT, "../../react-app/src/focusly.jsx"), "utf8"), /connectExtensionAccount\(/);
});

test("the website can transfer its existing account session to the selected extension ID", async () => {
  const previousChrome = globalThis.chrome;
  let sent;
  globalThis.chrome = { runtime: {
    sendMessage: (id, message, callback) => { sent = { id, message }; callback({ ok: true, synced: true }); },
  } };
  try {
    const result = await connectExtensionAccount({
      url: "https://project.supabase.co", anonKey: "public-anon-key", webUrl: "http://localhost:5173",
      targetId: "abcdefghijklmnopabcdefghijklmnop", nonce: "1abc-def0-1234-5678-90abcdef1234",
      session: { access_token: "access", refresh_token: "refresh", provider_token: "must-not-transfer", user: { id: "u1" } },
    });
    assert.deepEqual(result, { ok: true, synced: true, syncReason: null, version: null });
    assert.equal(sent.id, "abcdefghijklmnopabcdefghijklmnop");
    assert.equal(sent.message.type, "north-connect");
    assert.equal(sent.message.session.access_token, "access");
    assert.equal("provider_token" in sent.message.session, false);
    assert.equal(sent.message.webUrl, "http://localhost:5173");
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("the website turns an old extension's unknown connect message into a reload instruction", async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { runtime: {
    sendMessage: (_id, _message, callback) => callback({ ok: false, error: "unknown_message" }),
  } };
  try {
    const result = await connectExtensionAccount({
      url: "https://project.supabase.co", anonKey: "public-anon-key", webUrl: "http://localhost:5174",
      targetId: "abcdefghijklmnopabcdefghijklmnop", nonce: "1abc-def0-1234-5678-90abcdef1234",
      session: { access_token: "access", refresh_token: "refresh", user: { id: "u1" } },
    });
    assert.deepEqual(result, { ok: false, reason: "extension_outdated" });
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("usage intervals split at UTC midnight without losing or double-counting time", () => {
  const start = Date.parse("2026-10-19T23:59:30Z");
  const end = Date.parse("2026-10-20T00:00:45Z");
  assert.deepEqual(splitUsageInterval("example.com", start, end), [
    { day: "2026-10-19", host: "example.com", seconds: 30 },
    { day: "2026-10-20", host: "example.com", seconds: 45 },
  ]);
  assert.deepEqual(splitUsageInterval("", start, end), []);
  assert.deepEqual(splitUsageInterval("example.com", end, start), []);
  assert.deepEqual(splitUsageInterval("quick.example", start, start + 1000), [
    { day: "2026-10-19", host: "quick.example", seconds: 1 },
  ]);
});

test("browser usage counts only the foreground page and stops without an active page", () => {
  const tabs = selectUsageTabs(
    { id: 1, url: "https://work.example.com" },
    (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } },
    1234,
  );
  assert.deepEqual(tabs, [
    { tabId: 1, host: "work.example.com", since: 1234 },
  ]);
  assert.deepEqual(selectUsageTabs(null, httpHost, 1234), []);
  assert.deepEqual(selectUsageTabs({ id: 2, url: "chrome://newtab" }, httpHost, 1234), []);
});

test("usage history sums each website over an inclusive date range", () => {
  const result = aggregateUsageRange({
    "2026-10-18": { "example.com": 5, "north.app": 10 },
    "2026-10-19": { "example.com": 8 },
    "2026-10-20": { "north.app": 20 },
  }, "2026-10-18", "2026-10-20");
  assert.deepEqual(result, {
    from: "2026-10-18", to: "2026-10-20", days: 3,
    usage: [{ host: "north.app", seconds: 30 }, { host: "example.com", seconds: 13 }],
  });
  assert.equal(aggregateUsageRange({}, "not-a-date", "2026-10-20"), null);
  assert.equal(aggregateUsageRange({}, "2026-99-99", "2026-10-20"), null);
});

test("no message from a web page can turn blocking off or edit rules", () => {
  const origin = NORTH_WEB_ORIGINS[0];
  for (const type of [
    "disable-blocking",
    "pause-all",
    "removeSite",
    "addSite",
    "setRuleEnabled",
    "unblockRule",
    "unlinkAccount",
    "authSignOut",
    "startFocusSession",
    "__proto__",
    "",
  ]) {
    const res = externalAction({ type }, origin);
    assert.equal(res.ok, false, type);
    assert.equal(res.error, "unknown_message", type);
  }
});
