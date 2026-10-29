import test from "node:test";
import assert from "node:assert/strict";
import { observedInterval } from "../apps/extension/lib/usage.js";
import { splitHourlyInterval, mergeActivitySnapshots } from "../packages/shared-types/activity.js";
import { createSync } from "../react-app/src/lib/sync.js";
import { normalizeState, upsertUsageLimit, defaultBlocking } from "../packages/shared-types/blocking.js";

test("tracking never charges overnight gaps or a previous browser session", () => {
  const track = { since: 1000, browserSession: "this-run" };
  assert.deepEqual(observedInterval(track, 61000, "this-run"), { startAt: 1000, endAt: 61000 });
  assert.equal(observedInterval(track, 12 * 3600000, "this-run"), null);
  assert.equal(observedInterval(track, 61000, "new-run"), null);
  assert.equal(observedInterval({ since: 1000 }, 61000, "this-run"), null);
});

test("hourly collection splits boundaries without inventing or losing seconds", () => {
  const start = Date.parse("2026-10-23T12:59:59.500Z");
  assert.deepEqual(splitHourlyInterval(start, start + 1000), [
    { day: "2026-10-23", hour: "12", seconds: .5 },
    { day: "2026-10-23", hour: "13", seconds: .5 },
  ]);
});

test("account charts merge one snapshot per device and exclude Windows shell activity", () => {
  const base = { day: "2026-10-23", kind: "app", name: "Editor" };
  const rows = mergeActivitySnapshots([
    { ...base, device_id: "a", seconds: 20, hourly: { 12: 20 } },
    { ...base, device_id: "a", seconds: 30, hourly: { 12: 30 } },
    { ...base, device_id: "b", seconds: 10, hourly: { 12: 10 } },
    { ...base, name: "SearchApp", device_id: "a", seconds: 900 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seconds, 40);
  assert.equal(rows[0].hourly[12], 40);
});

test("existing Google account can be probed before attaching the sync engine", async () => {
  let queried;
  let completed = true;
  const client = { from: () => ({ select: () => ({ eq: (key, id) => {
    queried = [key, id];
    return { maybeSingle: async () => ({ data: { id, onboarding_complete: completed } }) };
  } }) }) };
  const sync = createSync({ client, store: {} });
  assert.equal(await sync.hasAccount("existing-user"), true);
  assert.deepEqual(queried, ["id", "existing-user"]);
  completed = false;
  assert.equal(await sync.hasAccount("new-user"), false);
});

test("app session and website limits coexist through account normalization", () => {
  let state = upsertUsageLimit(defaultBlocking(), { id: "web", kind: "website", target: "example.com", mode: "daily", dailyLimitMinutes: 20 });
  state = upsertUsageLimit(state, { id: "app", kind: "app", target: "notepad", mode: "session", dailyLimitMinutes: 5 });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.usageLimits.length, 2);
  assert.equal(restored.usageLimits.find((limit) => limit.id === "app").mode, "session");
  assert.equal(restored.usageLimits.find((limit) => limit.id === "app").dailyLimitMinutes, 5);
});
