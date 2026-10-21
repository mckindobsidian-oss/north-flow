/**
 * NORTH — reminders v2: kinds, per-task preference, cancellation, events.
 *
 * Extends (never replaces) the original daily-dedup contract: one ledger,
 * one fire per key per day, four kinds now instead of one, and explicit
 * cancellation when a task completes or an event disappears.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildReminderPlan, reminderKindForTask, cancelStaleReminders, recordFired, REMINDER_KINDS,
} from "../react-app/src/lib/reminders.js";

const TODAY = "2026-09-25";
const T1 = "11111111-2222-4333-8444-555555555555";
const T2 = "22222222-3333-4444-8555-666666666666";
const T3 = "33333333-4444-4555-8666-777777777777";
const task = (id, over = {}) => ({ id, title: `Task ${id.slice(0, 4)}`, completed: false, ...over });

test("kind taxonomy is fixed", () => {
  assert.deepEqual(REMINDER_KINDS, ["due-today", "upcoming", "overdue", "event"]);
});

test("due-today, upcoming (within lead) and overdue are distinguished", () => {
  assert.equal(reminderKindForTask(task(T1, { due: TODAY }), TODAY), "due-today");
  assert.equal(reminderKindForTask(task(T2, { due: "2026-09-26" }), TODAY), "upcoming", "tomorrow is within the 1-day lead");
  assert.equal(reminderKindForTask(task(T2, { due: "2026-09-30" }), TODAY), null, "far-future stays quiet");
  assert.equal(reminderKindForTask(task(T3, { due: "2026-09-20" }), TODAY), "overdue");
  assert.equal(reminderKindForTask({ ...task(T1, { due: TODAY }), completed: true }, TODAY), null);
  assert.equal(reminderKindForTask({ ...task(T1, { due: TODAY }), remindOn: "none" }, TODAY), null, "per-task opt-out");
  assert.equal(reminderKindForTask({ ...task(T2, { due: "2026-09-30" }), remindOn: "all" }, TODAY, 5), "upcoming", "opt-in widens the lead");
});

test("the plan fires each kind once per day and never duplicates", () => {
  const tasks = [task(T1, { due: TODAY }), task(T2, { due: "2026-09-26" }), task(T3, { due: "2026-09-20" })];
  const plan = buildReminderPlan(tasks, [], TODAY, {});
  assert.deepEqual(plan.map((p) => p.kind).sort(), ["due-today", "overdue", "upcoming"]);
  const ledger = recordFired(plan.map((p) => p.key), TODAY, {}, 1000);
  assert.deepEqual(buildReminderPlan(tasks, [], TODAY, ledger), [], "second tick: nothing");
});

test("calendar events become reminders only for today's events, with their own key space", () => {
  const events = [
    { gcalId: "evt-1", title: "Standup", day: TODAY, start: Date.now() - 1000, end: Date.now() + 36e5 },
    { gcalId: "evt-2", title: "Tomorrow thing", day: "2026-09-26", start: Date.now() + 864e5, end: Date.now() + 9e7 },
  ];
  const plan = buildReminderPlan([], events, TODAY, {}, { includeEvents: true });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, "event");
  assert.equal(plan[0].key, `${TODAY}:g:evt-1`, "g-prefix keeps event keys apart from task ids");
});

test("completing a task cancels its reminders — pending and fired; deleting too", () => {
  const tasks = [task(T1, { due: TODAY }), task(T2, { due: TODAY })];
  const plan = buildReminderPlan(tasks, [], TODAY, {});
  const ledger = recordFired(plan.map((p) => p.key), TODAY, {}, 1000); // both fired
  // T1 completes: its entries drop (a completed task must never remind again).
  const after = cancelStaleReminders(ledger, [task(T1, { due: TODAY, completed: true }), task(T2, { due: TODAY })], []);
  assert.deepEqual(after, { [`${TODAY}:${T2}`]: 1000 }, "completed task's entries dropped, live task's kept");
  const cleaned = cancelStaleReminders(ledger, [], []);
  assert.deepEqual(cleaned, {}, "deleted tasks drop every entry");
});

test("a vanished calendar event cancels its reminder", () => {
  const events = [{ gcalId: "evt-1", title: "Standup", day: TODAY, start: Date.now(), end: Date.now() + 36e5 }];
  const plan = buildReminderPlan([], events, TODAY, {}, { includeEvents: true });
  const ledger = recordFired([plan[0].key], TODAY, {}, 1000);
  assert.deepEqual(cancelStaleReminders(ledger, [], []), {}, "event gone → entry gone");
  assert.deepEqual(cancelStaleReminders(ledger, [], events), ledger, "event alive → entry stays");
});
