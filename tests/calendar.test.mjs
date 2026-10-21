/**
 * NORTH — Google Calendar normalization + unified day view (pure modules).
 *
 * Pins the contract with Google's API shapes: all-day vs timed events,
 * timezone conversion to local day keys, cancelled-event removal, idempotent
 * merging (no duplicates across syncs), and the strict task/event separation
 * the product promises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEvent, normalizeEvents, mergeCache, eventsForDay, upcomingEvents,
  nextEvent, eventTimeLabel, saveCache, loadCache,
} from "../react-app/src/lib/calendar.js";
import { dayView } from "../react-app/src/lib/dayview.js";

const TIMED = {
  id: "evt-1",
  status: "confirmed",
  summary: "Design review",
  start: { dateTime: "2026-09-25T09:00:00+05:30" }, // IST
  end: { dateTime: "2026-09-25T10:00:00+05:30" },
  location: "Room 2",
};
const ALL_DAY = {
  id: "evt-2",
  status: "confirmed",
  summary: "Offsite",
  start: { date: "2026-09-26" },
  end: { date: "2026-09-27" },
};
const CANCELLED = { id: "evt-3", status: "cancelled", summary: "Cancelled standup", start: TIMED.start, end: TIMED.end };

// Times in UTC for deterministic local-day math (tests run in the runner's
// local zone; use date-only comparisons or timezone-explicit events).
const TZ = -new Date().getTimezoneOffset() / 60;
const tzEvent = (id, y, m, d, hh, mm = 0) => ({
  id,
  status: "confirmed",
  summary: `Event ${id}`,
  start: { dateTime: new Date(y, m - 1, d, hh, mm).toISOString() },
  end: { dateTime: new Date(y, m - 1, d, hh + 1, mm).toISOString() },
});
const fmtDay = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

test("a timed event normalizes with local day, times and metadata", () => {
  const n = normalizeEvent(TIMED);
  assert.equal(n.gcalId, "evt-1");
  assert.equal(n.title, "Design review");
  assert.equal(n.allDay, false);
  assert.equal(n.location, "Room 2");
  assert.equal(n.start, Date.parse("2026-09-25T09:00:00+05:30"));
  assert.equal(n.end, Date.parse("2026-09-25T10:00:00+05:30"));
});

test("an all-day event normalizes with a date-only day key and the all-day flag", () => {
  const n = normalizeEvent(ALL_DAY);
  assert.equal(n.allDay, true);
  assert.equal(n.day, "2026-09-26");
  assert.equal(eventTimeLabel(n), "All day");
  assert.equal(n.start, Date.parse("2026-09-26T00:00:00"));
});

test("cancelled events arrive as tombstones; malformed ones are dropped", () => {
  // A cancellation must be representable so the merge can delete the id.
  assert.deepEqual(normalizeEvent(CANCELLED), { gcalId: "evt-3", cancelled: true });
  assert.equal(normalizeEvent({ id: "x", status: "confirmed", summary: "no times" }), null);
  assert.equal(normalizeEvent(null), null);
  const list = normalizeEvents([TIMED, CANCELLED, { bogus: true }, ALL_DAY]);
  assert.deepEqual(list.map((e) => e.gcalId), ["evt-1", "evt-2", "evt-3"]); // tombstone sorts last
  assert.equal(list.filter((e) => !e.cancelled).length, 2);
});

test("timezone handling: the local day key follows the event's instant", () => {
  // 23:30 local on the 25th must land on the 25th locally even if UTC says the 26th.
  const local = new Date(2026, 8, 25, 23, 30);
  const n = normalizeEvent({
    id: "tz-1", status: "confirmed", summary: "Late call",
    start: { dateTime: new Date(Date.UTC(2026, 8, 25, 23, 30 - local.getTimezoneOffset() * -1)).toISOString() },
    end: { dateTime: new Date(Date.UTC(2026, 8, 25, 23, 30 - local.getTimezoneOffset() * -1) + 36e5).toISOString() },
  });
  assert.equal(n.day, fmtDay(2026, 9, 25));
});

test("repeated syncs merge idempotently — no duplicate events ever", () => {
  const first = normalizeEvents([TIMED, ALL_DAY]);
  const second = normalizeEvents([TIMED, ALL_DAY, { ...TIMED, summary: "Renamed review" }]);
  const cache = mergeCache(mergeCache([], first), second);
  assert.equal(cache.length, 2, "same ids overwrite, never append");
  assert.equal(cache.find((e) => e.gcalId === "evt-1").title, "Renamed review");
  // A cancelled re-fetch propagates the deletion through its tombstone.
  const third = normalizeEvents([{ ...TIMED, status: "cancelled" }, ALL_DAY]);
  const after = mergeCache(cache, third);
  assert.equal(after.some((e) => e.gcalId === "evt-1"), false, "cancelled events drop out");
  assert.equal(after.some((e) => e.cancelled), false, "tombstones never persist in the cache");
  assert.equal(after.length, 1);
});

test("an empty or failed fetch preserves the previous cache (offline safety)", () => {
  const cache = saveCache(normalizeEvents([TIMED]), 1234);
  const loaded = loadCache(cache);
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.fetchedAt, 1234);
  // The caller never persists a failed fetch, so loadCache(null) yields an
  // empty envelope rather than throwing — and the disk copy survives.
  assert.deepEqual(loadCache(null), { events: [], fetchedAt: 0 });
});

test("day filtering and upcoming selection slice correctly", () => {
  const e1 = { ...normalizeEvent(tzEvent("a", 2026, 9, 25, 9)), day: fmtDay(2026, 9, 25) };
  const e2 = { ...normalizeEvent(tzEvent("b", 2026, 9, 25, 14)), day: fmtDay(2026, 9, 25) };
  const e3 = { ...normalizeEvent(tzEvent("c", 2026, 9, 26, 9)), day: fmtDay(2026, 9, 26) };
  const all = [e1, e2, e3];
  assert.equal(eventsForDay(all, fmtDay(2026, 9, 25)).length, 2);
  const now = new Date(2026, 8, 25, 12).getTime(); // 12:00 on the 25th
  assert.deepEqual(upcomingEvents(all, now).map((e) => e.gcalId), ["b", "c"]);
  assert.equal(nextEvent(all, now).gcalId, "b");
});

test("task ↔ calendar separation: tasks and events are distinct types in the day view", () => {
  const taskId = "task-uuid-1";
  const tasks = [
    { id: taskId, title: "Ship report", due: fmtDay(2026, 9, 25), completed: false, pri: "high" },
    { id: "task-uuid-2", title: "Old chore", due: fmtDay(2026, 9, 20), completed: false, pri: "low" },
    { id: "task-uuid-3", title: "Done thing", due: fmtDay(2026, 9, 25), completed: true, pri: "medium" },
  ];
  const events = normalizeEvents([tzEvent("evt-9", 2026, 9, 25, 15)]).map((e) => ({ ...e, day: fmtDay(2026, 9, 25) }));
  const now = new Date(2026, 8, 25, 10).getTime();
  const dv = dayView(tasks, events, { minutes: 50, sessions: 2 }, fmtDay(2026, 9, 25), now);

  assert.equal(dv.tasks.length, 1, "only today's open tasks");
  assert.equal(dv.completed.length, 1);
  assert.deepEqual(dv.overdue.map((t) => t.id), ["task-uuid-2"]);
  assert.equal(dv.events.length, 1);
  assert.equal(dv.nextEvent.gcalId, "evt-9");
  assert.equal(dv.focusMinutes, 50);
  // The merged rail labels each item's type — no object can be both.
  const types = new Set(dv.next.map((i) => i.type));
  assert.ok(types.has("task") && types.has("event"));
  for (const item of dv.next) {
    assert.equal(item.type === "event", String(item.id).startsWith("evt-"), "events are marked events");
  }
  assert.deepEqual(dv.overdue.map((t) => t.id), ["task-uuid-2"]);
});
