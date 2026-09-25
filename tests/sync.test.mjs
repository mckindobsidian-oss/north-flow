/**
 * NORTH — backend mapping tests (pure half of `react-app/src/lib/sync.js`).
 *
 * The sync engine's network half needs a live database and a signed-in account,
 * but the half that can silently corrupt data — translating between the app's
 * shapes and the table rows — is pure, and that is what this file pins down. A
 * mapping bug here either loses a user's task or writes a row the schema
 * rejects, so every mapper is checked in both directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultBlocking } from "../packages/shared-types/blocking.js";
import {
  BOARD_COL_IDS, boardToRow, docFromProfile, isUuid, newUuid, profileFromRows,
  pushable, rowToBoard, rowToSession, rowToTask, sessionToRow, signature, taskToRow,
} from "../react-app/src/lib/sync-map.js";

const USER = "11111111-2222-4333-8444-555555555555";
const BOARD = "22222222-3333-4444-8555-666666666666";

test("newUuid produces a uuid the database will accept, and ids are unique", () => {
  const a = newUuid();
  const b = newUuid();
  assert.ok(isUuid(a), `not a uuid: ${a}`);
  assert.ok(isUuid(b));
  assert.notEqual(a, b);
  assert.equal(isUuid("t1"), false);
  assert.equal(isUuid(""), false);
});

test("a board round-trips and always comes back with the three fixed columns", () => {
  const board = { id: BOARD, name: "Product Launch" };
  const row = boardToRow(board, USER, 2);
  assert.deepEqual(row, { id: BOARD, user_id: USER, name: "Product Launch", position: 2 });
  const back = rowToBoard(row);
  assert.equal(back.id, BOARD);
  assert.equal(back.name, "Product Launch");
  assert.deepEqual(back.cols.map((c) => c.id), BOARD_COL_IDS);
  assert.equal(back.cols[0].name, "To do");
});

test("a task round-trips with its board and column intact", () => {
  const task = {
    id: newUuid(), title: "Ship the landing page", due: "2026-09-25", pri: "high",
    cat: "Work", completed: false, at: 1_700_000_000_000,
    boardId: BOARD, colId: "doing",
  };
  const row = taskToRow(task, USER, 3);
  assert.equal(row.due_date, "2026-09-25");
  assert.equal(row.priority, "high");
  assert.equal(row.board_id, BOARD);
  assert.equal(row.col_id, "doing");
  assert.equal(row.position, 3);

  // A plain (unscheduled, board-less) task.
  const back = rowToTask({ ...row, created_at: new Date(task.at).toISOString() });
  assert.equal(back.title, task.title);
  assert.equal(back.due, task.due);
  assert.equal(back.pri, "high");
  assert.equal(back.cat, "Work");
  assert.equal(back.completed, false);
  assert.equal(back.boardId, BOARD);
  assert.equal(back.colId, "doing");
  assert.equal(back.at, task.at);

  const plain = rowToTask({ ...taskToRow({ id: newUuid(), title: "Read", pri: "low", cat: "Study" }, USER, 0), created_at: "2026-01-01T00:00:00.000Z" });
  assert.equal(plain.due, "");
  assert.equal("boardId" in plain, false, "absent boardId, not an empty one");
  assert.equal("colId" in plain, false);
});

test("a task with values the schema rejects is sanitized instead of failing the push", () => {
  const row = taskToRow(
    { id: newUuid(), title: "x", due: "2026-09-25T10:00:00Z", pri: "urgent", cat: "Nope", boardId: "legacy-id", colId: "somewhere" },
    USER, 0
  );
  assert.equal(row.priority, "medium");
  assert.equal(row.category, "Nope"); // category has no check constraint
  assert.equal(row.due_date, "2026-09-25"); // date column wants a date
  assert.equal(row.board_id, null, "a non-uuid board cannot satisfy the foreign key");
  assert.equal(row.col_id, null);
});

test("a focus session round-trips, and actual seconds can never exceed the plan", () => {
  const start = Date.parse("2026-09-25T09:00:00.000Z");
  const session = {
    id: newUuid(), type: "focus", start, end: start + 1_500_000,
    planned: 1500, actual: 1500, completed: true,
  };
  const row = sessionToRow(session, USER);
  assert.equal(row.planned_s, 1500);
  assert.equal(row.actual_s, 1500);
  assert.equal(row.started_at, "2026-09-25T09:00:00.000Z");
  assert.equal(row.phase, "focus");
  const back = rowToSession(row);
  assert.equal(back.start, start);
  assert.equal(back.actual, 1500);
  assert.equal(back.completed, true);

  // The table's CHECK is actual_s <= planned_s + 1; an inflated record is
  // clamped so one odd row cannot fail the batch.
  const inflated = sessionToRow({ ...session, planned: 60, actual: 9999 }, USER);
  assert.equal(inflated.actual_s, 61);
  // An unknown phase falls back to 'focus' rather than violating the CHECK.
  assert.equal(sessionToRow({ ...session, type: "nap" }, USER).phase, "focus");
});

test("the shared document keeps rules, schedules, settings and apps — and drops the ephemeral fields", () => {
  const blocking = defaultBlocking();
  blocking.rules = [{ id: "r1", kind: "website", target: "youtube.com", label: "", enabled: true, when: "always", scheduleIds: [], createdAt: 1 }];
  blocking.schedules = [{ id: "s1", name: "Work hours", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", enabled: true }];
  blocking.settings = { ...blocking.settings, tempUnblockMinutes: 10 };
  blocking.unblocks = { r1: Date.now() + 60000 };       // device-local
  blocking.focus = { startedAt: Date.now(), minutes: 25, endAt: Date.now() + 60000 }; // device-local

  const doc = docFromProfile({
    name: "Aarav", email: "aarav@example.com", pm: { w: 30 },
    apps: [{ id: "a1", name: "Instagram" }], blocking,
  });

  assert.equal(doc.name, "Aarav");
  assert.equal(doc.pm.w, 30);
  assert.equal(doc.apps.length, 1);
  assert.equal(doc.blocking.rules.length, 1);
  assert.equal(doc.blocking.schedules.length, 1);
  assert.equal(doc.blocking.settings.tempUnblockMinutes, 10);
  assert.equal("focus" in doc.blocking, false, "a running session belongs to one device");
  assert.equal("unblocks" in doc.blocking, false, "a pause belongs to one device");
});

test("a profile is rebuilt from its rows into something a screen can render at once", () => {
  const taskId = newUuid();
  const profile = profileFromRows({
    un: "aarav",
    profileRow: {
      un: "aarav", name: "Aarav", email: "aarav@example.com", created_at: "2026-09-01T00:00:00.000Z",
      settings: {
        pm: { w: 30, sb: 5, lb: 15 },
        apps: [{ id: "a1", name: "Instagram", icon: "📸", limit: 45, used: 0, blocked: false, lastD: "2026-09-25" }],
        blockDuringFocus: false,
        blocking: {
          rules: [{ id: "r1", kind: "website", target: "reddit.com", label: "", enabled: false, when: "focus", scheduleIds: [] }],
          schedules: [],
          settings: { blockDuringFocus: true, allowTemporaryUnblock: true, tempUnblockMinutes: 5 },
        },
      },
    },
    taskRows: [{
      id: taskId, title: "Plan the week", due_date: "2026-09-26", priority: "medium",
      category: "Personal", completed: false, board_id: null, col_id: null,
      created_at: "2026-09-20T00:00:00.000Z",
    }],
    friendRows: [{ friend_un: "zoya" }],
  });

  assert.equal(profile.un, "aarav");
  assert.equal(profile.name, "Aarav");
  assert.equal(profile.tasks.length, 1);
  assert.equal(profile.tasks[0].title, "Plan the week");
  assert.deepEqual(profile.friends, ["zoya"]);
  assert.equal(profile.apps.length, 1);
  assert.equal(profile.pm.w, 30);
  assert.equal(profile.blocking.rules.length, 1);
  assert.equal(profile.blocking.rules[0].when, "focus");
  // The schema-shaped column wins only when the client document is silent.
  assert.equal(profile.blocking.settings.blockDuringFocus, true);
  // Ephemeral state is always reset on load, never resurrected from the server.
  assert.deepEqual(profile.blocking.unblocks, {});
  assert.equal(profile.blocking.focus, null);
});

test("a profile with no settings still hydrates into a usable record", () => {
  const profile = profileFromRows({ un: "newbie", profileRow: { un: "newbie" } });
  assert.equal(profile.name, "newbie");
  assert.equal(profile.pm.w, 25);
  assert.deepEqual(profile.tasks, []);
  assert.ok(profile.blocking.rules.length >= 0);
  assert.equal(profile.blocking.settings.blockDuringFocus, true);
});

test("only keys with a destination are pushed", () => {
  assert.equal(pushable("u:aarav"), true);
  assert.equal(pushable("bd:aarav"), true);
  assert.equal(pushable("fs:aarav:2026-09-25"), true);
  // Derived or device-local keys must never be pushed.
  assert.equal(pushable("fo:aarav:2026-09-25"), false, "daily totals are rolled up by the database");
  assert.equal(pushable("lb:aarav"), false, "the leaderboard reads from the server aggregate");
  assert.equal(pushable("sess"), false);
});

test("the fingerprint ignores the focus window but notices a real edit", () => {
  const key = "u:aarav";
  const base = {
    un: "aarav", name: "Aarav", tasks: [{ id: newUuid(), title: "Ship", pri: "high", cat: "Work", completed: false }],
    blocking: defaultBlocking(),
  };

  // Starting, pausing or finishing a session must cost nothing.
  const paused = { ...base, blocking: { ...base.blocking, focus: { startedAt: 1, minutes: 25, endAt: 2 } } };
  assert.equal(signature(key, base), signature(key, paused));

  const unblocked = { ...base, blocking: { ...base.blocking, unblocks: { r1: 123 } } };
  assert.equal(signature(key, base), signature(key, unblocked));

  // A real change is pushed.
  const renamed = { ...base, name: "Aarav S." };
  assert.notEqual(signature(key, base), signature(key, renamed));
  const ticked = { ...base, tasks: [{ ...base.tasks[0], completed: true }] };
  assert.notEqual(signature(key, base), signature(key, ticked));
  const newRule = {
    ...base,
    blocking: { ...base.blocking, rules: [{ id: "r9", kind: "website", target: "x.com", label: "", enabled: true, when: "always", scheduleIds: [] }] },
  };
  assert.notEqual(signature(key, base), signature(key, newRule));

  // Board order and session membership fingerprint by identity.
  assert.notEqual(signature("bd:aarav", [{ id: BOARD }]), signature("bd:aarav", [{ id: BOARD, name: "Renamed" }]));
  assert.notEqual(signature("fs:aarav:2026-09-25", [{ id: "a" }]), signature("fs:aarav:2026-09-25", [{ id: "a" }, { id: "b" }]));
});
