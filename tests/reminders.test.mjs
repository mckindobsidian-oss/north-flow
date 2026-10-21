/**
 * NORTH — task due-date reminder logic (`react-app/src/lib/reminders.js`).
 *
 * The whole point of this module is that the same reminder never fires twice
 * and never fires for a task that is not due. These tests pin both, plus the
 * offline/restart story: the ledger is the only memory, so a cold start with
 * a populated ledger must not re-fire anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dayOf, dueTasks, pendingReminders, recordFired, reminderTick } from "../react-app/src/lib/reminders.js";

const T1 = "11111111-2222-4333-8444-555555555555";
const T2 = "22222222-3333-4444-8555-666666666666";
const T3 = "33333333-4444-4555-8666-777777777777";
const TODAY = "2026-09-25";

const task = (id, over = {}) => ({ id, title: `Task ${id.slice(0, 4)}`, completed: false, ...over });

test("dayOf renders a local YYYY-MM-DD", () => {
  assert.equal(dayOf(Date.parse("2026-09-25T14:30:00")), TODAY);
  assert.equal(dayOf(Date.parse("2026-01-05T00:05:00")), "2026-01-05");
});

test("a task is due when today or overdue, never when future or completed", () => {
  const tasks = [
    task(T1, { due: TODAY }),                 // due today
    task(T2, { due: "2026-09-20" }),          // overdue
    task(T3, { due: "2026-10-01" }),          // future — no reminder
    task("44444444-5555-4666-8777-888888888888", { due: TODAY, completed: true }), // done
    task("55555555-6666-4777-8888-999999999999"), // no due date at all
  ];
  const due = dueTasks(tasks, TODAY);
  assert.deepEqual(due.map((t) => t.id), [T1, T2]);
});

test("pendingReminders fires each due task once, then never again that day", () => {
  const tasks = [task(T1, { due: TODAY }), task(T2, { due: "2026-09-20" })];
  const first = pendingReminders(tasks, TODAY, {});
  assert.deepEqual(first, [`${TODAY}:${T1}`, `${TODAY}:${T2}`].sort());

  // After both fire, nothing is pending — the duplicate-notification case.
  const ledger = recordFired(first, TODAY, {}, 1_000);
  assert.deepEqual(pendingReminders(tasks, TODAY, ledger), []);
});

test("a completed task stops reminding even if its key already fired", () => {
  const tasks = [task(T1, { due: TODAY })];
  const ledger = recordFired([`${TODAY}:${T1}`], TODAY, {}, 1_000);
  assert.deepEqual(pendingReminders(tasks.map((t) => ({ ...t, completed: true })), TODAY, ledger), []);
});

test("a restart with a saved ledger re-fires nothing (offline safety)", () => {
  const tasks = [task(T1, { due: TODAY })];
  // The ledger came from device storage in a previous session.
  const saved = { [`${TODAY}:${T1}`]: Date.now() - 3_600_000 };
  assert.deepEqual(pendingReminders(tasks, TODAY, saved), []);
});

test("a task due again tomorrow gets a fresh reminder (per-day keys)", () => {
  const tasks = [task(T1, { due: "2026-09-26" })];
  const TOMORROW = "2026-09-26";
  const l1 = recordFired(pendingReminders(tasks, TODAY, {}), TODAY, {}, 1_000); // fired while due "today"
  // The day rolls over; the task is now due on a different key.
  assert.deepEqual(pendingReminders([{ ...tasks[0], due: TOMORROW }], TOMORROW, l1), [`${TOMORROW}:${T1}`]);
});

test("recordFired prunes ledger keys older than yesterday", () => {
  const old = { ["2026-08-01:dead"]: 1, [`${TODAY}:x`]: 2 };
  const next = recordFired([`${TODAY}:${T1}`], TODAY, old, 5_000);
  assert.equal("2026-08-01:dead" in next, false, "ancient keys are garbage-collected");
  assert.equal(next[`${TODAY}:x`], 2);
  assert.equal(next[`${TODAY}:${T1}`], 5_000);
});

test("reminderTick fires and records atomically — a caller cannot forget the ledger", () => {
  const tasks = [task(T1, { due: TODAY }), task(T2, { due: TODAY })];
  const { toFire, nextLedger } = reminderTick(tasks, TODAY, {});
  assert.equal(toFire.length, 2);
  for (const key of toFire) assert.ok(nextLedger[key], "every fired key is recorded");
  // A second identical tick must be empty.
  const second = reminderTick(tasks, TODAY, nextLedger);
  assert.deepEqual(second.toFire, []);
});

test("malformed tasks never crash the tick", () => {
  const tasks = [null, { id: T3 }, task(T1, { due: TODAY })];
  const { toFire } = reminderTick(tasks, TODAY, {});
  assert.deepEqual(toFire, [`${TODAY}:${T1}`]);
  assert.deepEqual(reminderTick(undefined, TODAY, {}).toFire, []);
});
