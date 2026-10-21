/**
 * NORTH — analytics over real stored data (pure module).
 *
 * The contract being pinned: no invented numbers. Empty days are zeros, a
 * week-over-week trend without a baseline is null (not 0%), and per-task time
 * comes only from sessions actually linked by taskId.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { analyticsSummary, isHiddenUsageSite } from "../react-app/src/lib/analytics.js";

const NOW = new Date(2026, 8, 25, 18).getTime(); // Sep 25 2026 local evening
const day = (offset) => {
  const d = new Date(NOW - offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const T1 = "11111111-2222-4333-8444-555555555555";
const T2 = "22222222-3333-4444-8555-666666666666";

test("hidden website preferences match the exact site and its subdomains only", () => {
  assert.equal(isHiddenUsageSite("www.youtube.com", ["youtube.com"]), true);
  assert.equal(isHiddenUsageSite("music.youtube.com", ["youtube.com"]), true);
  assert.equal(isHiddenUsageSite("notyoutube.com", ["youtube.com"]), false);
  assert.equal(isHiddenUsageSite("youtube.com", []), false);
});

const sess = (day_, mins, opts = {}) => ({
  id: `s-${day_}-${Math.random().toString(36).slice(2, 6)}`,
  type: "focus",
  start: Date.now(), end: Date.now(),
  planned: mins * 60, actual: mins * 60,
  completed: true, ...opts,
});

test("totals come only from real focus records", () => {
  const byDay = {
    [day(0)]: [sess(day(0), 25), sess(day(0), 15)],
    [day(1)]: [sess(day(1), 30)],
    [day(2)]: [sess(day(2), 20, { completed: false })], // skipped session — partial
  };
  const a = analyticsSummary(byDay, [], NOW);
  assert.equal(a.totals.sessions, 4, "every focus record is a session, completed or skipped");
  assert.ok(a.totals.focusMinutes >= 85, "focused minutes from actuals (skipped banks its partial time)");
  assert.equal(a.totals.activeDays, 3);
});

test("empty data produces honest zeros, never invented numbers", () => {
  const a = analyticsSummary({}, [], NOW);
  assert.equal(a.totals.focusMinutes, 0);
  assert.equal(a.totals.sessions, 0);
  assert.equal(a.totals.activeDays, 0);
  assert.equal(a.streak, 0);
  assert.equal(a.weekTrend.changePct, null, "no baseline → no fake percentage");
  assert.deepEqual(a.topTasks, []);
});

test("streak counts consecutive focus days ending today or yesterday", () => {
  const byDay = {
    [day(0)]: [sess(day(0), 25)],
    [day(1)]: [sess(day(1), 25)],
    [day(2)]: [sess(day(2), 25)],
    [day(4)]: [sess(day(4), 25)], // gap on day 3 breaks the run
  };
  assert.equal(analyticsSummary(byDay, [], NOW).streak, 3);
  // Nothing today or yesterday → streak 0 even with history.
  const old = { [day(3)]: [sess(day(3), 25)], [day(4)]: [sess(day(4), 25)] };
  assert.equal(analyticsSummary(old, [], NOW).streak, 0);
});

test("per-task focus time uses only linked sessions", () => {
  const byDay = {
    [day(0)]: [sess(day(0), 25, { taskId: T1 }), sess(day(0), 10, { taskId: T2 }), sess(day(0), 5)],
  };
  const tasks = [
    { id: T1, title: "Write report", completed: false },
    { id: T2, title: "Deleted task", completed: false },
  ];
  const a = analyticsSummary(byDay, tasks, NOW);
  assert.equal(a.topTasks.length, 2);
  assert.equal(a.topTasks[0].title, "Write report");
  assert.equal(a.topTasks[0].minutes, 25);
  assert.equal(a.topTasks[1].minutes, 10);
  // Unlinked time appears nowhere in the per-task table.
  assert.equal(a.topTasks.reduce((acc, t) => acc + t.minutes, 0), 35);
});

test("week trend is computed from the two adjacent weeks", () => {
  const byDay = { [day(0)]: [sess(day(0), 100)], [day(7)]: [sess(day(7), 50)] };
  const a = analyticsSummary(byDay, [], NOW);
  assert.equal(a.weekTrend.thisWeekMinutes, 100);
  assert.equal(a.weekTrend.lastWeekMinutes, 50);
  assert.equal(a.weekTrend.changePct, 100);
});

test("task counts stay real over the window", () => {
  const tasks = [
    { id: T1, title: "A", completed: true, at: NOW - 3 * 86400000 },   // inside
    { id: T2, title: "B", completed: false, at: NOW - 35 * 86400000 }, // outside 4-week window
  ];
  const a = analyticsSummary({}, tasks, NOW);
  assert.equal(a.tasks.total, 1, "only tasks created inside the window count");
  assert.equal(a.tasks.completed, 1);
  assert.equal(a.tasks.open, 0);
});
