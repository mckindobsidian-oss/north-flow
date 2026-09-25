/**
 * NORTH — backend mapping (pure, no network, no DOM).
 *
 * Split out of `sync.js` for one practical reason: `sync.js` imports the
 * Supabase client, which reads `import.meta.env` and cannot be loaded by Node's
 * test runner. Everything here is a pure function, so `tests/sync.test.mjs` can
 * prove the app-shape ⇄ table-row round trip without a database — which is the
 * part of a sync layer that is actually worth testing in isolation.
 *
 * The shapes are the ones in `packages/shared-types/` and the tables are the
 * ones in `supabase/schema.sql`; this file is where the two meet.
 */

import { defaultBlocking, normalizeState } from "../shared/blocking.js";

// Board columns are fixed by the product. These mirror BOARD_COL_NAMES in
// packages/shared-types/index.js; only the shared *engine* modules are vendored
// into every client (scripts/sync-shared.mjs), so the three names repeat here
// rather than adding a fourth vendored file.
const BOARD_COL_NAMES = { todo: "To do", doing: "Doing", done: "Done" };
export const BOARD_COL_IDS = ["todo", "doing", "done"];

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => uuidRe.test(String(v || ""));

/**
 * A real uuid, with a fallback for browsers without `crypto.randomUUID`
 * (it needs a secure context, so plain-HTTP LAN testing would not have it).
 */
export function newUuid() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch { /* fall through to Math.random */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── boards ────────────────────────────────────────────────────────────────
export function boardToRow(board, userId, position) {
  return { id: board.id, user_id: userId, name: String(board.name || "Board"), position };
}

/** The board's columns are fixed by the product (to do / doing / done). */
export function rowToBoard(row) {
  return {
    id: row.id,
    name: row.name,
    cols: BOARD_COL_IDS.map((id) => ({ id, name: BOARD_COL_NAMES[id] })),
  };
}

// ── tasks ─────────────────────────────────────────────────────────────────
export function taskToRow(task, userId, position) {
  return {
    id: task.id,
    user_id: userId,
    title: String(task.title || "").slice(0, 500),
    due_date: task.due ? String(task.due).slice(0, 10) : null,
    priority: ["low", "medium", "high"].includes(task.pri) ? task.pri : "medium",
    category: task.cat || "Personal",
    completed: Boolean(task.completed),
    // A card may only point at a board that exists as a row; anything else
    // would break the foreign key and fail the whole push.
    board_id: isUuid(task.boardId) ? task.boardId : null,
    col_id: BOARD_COL_IDS.includes(task.colId) ? task.colId : null,
    position,
  };
}

export function rowToTask(row) {
  const task = {
    id: row.id,
    title: row.title,
    due: row.due_date || "",
    pri: row.priority,
    cat: row.category,
    completed: Boolean(row.completed),
    at: Date.parse(row.created_at) || Date.now(),
  };
  // Absent keys, not empty ones: the app tests `task.boardId` and `task.colId`.
  if (row.board_id) task.boardId = row.board_id;
  if (row.col_id) task.colId = row.col_id;
  return task;
}

// ── focus sessions ────────────────────────────────────────────────────────
export function sessionToRow(session, userId) {
  const planned = Math.max(0, Math.round(Number(session.planned) || 0));
  // The table enforces actual_s <= planned_s + 1 (a session can never be
  // recorded as longer than it was planned). Clamp here so one odd record
  // cannot fail the whole batch on a constraint.
  const actual = Math.max(0, Math.min(planned + 1, Math.round(Number(session.actual) || 0)));
  return {
    id: session.id,
    user_id: userId,
    phase: ["focus", "shortBreak", "longBreak"].includes(session.type) ? session.type : "focus",
    started_at: new Date(Number(session.start) || Date.now()).toISOString(),
    ended_at: new Date(Number(session.end) || Date.now()).toISOString(),
    planned_s: planned,
    actual_s: actual,
    completed: Boolean(session.completed),
  };
}

export function rowToSession(row) {
  return {
    id: row.id,
    type: row.phase,
    start: Date.parse(row.started_at),
    end: Date.parse(row.ended_at),
    planned: row.planned_s,
    actual: row.actual_s,
    completed: Boolean(row.completed),
  };
}

// ── profile document ──────────────────────────────────────────────────────
/**
 * The shareable half of a profile record, stored in `profiles.settings`. It
 * deliberately excludes the ephemeral blocking fields (a running focus window
 * and temporary unblocks), which belong to one device and would otherwise let
 * one client pause another's enforcement.
 */
export function docFromProfile(profile) {
  const b = normalizeState(profile.blocking || defaultBlocking());
  return {
    name: profile.name || "",
    email: profile.email || "",
    apps: Array.isArray(profile.apps) ? profile.apps : [],
    pm: profile.pm || {},
    blocking: { rules: b.rules, schedules: b.schedules, settings: b.settings },
  };
}

/** Rebuild a profile record from a `profiles` row plus its companion tables. */
export function profileFromRows({ un, profileRow, taskRows = [], friendRows = [] }) {
  const settings = profileRow?.settings || {};
  const blocking = settings.blocking || {};
  return {
    un,
    name: profileRow?.name || un,
    email: profileRow?.email || "",
    createdAt: Date.parse(profileRow?.created_at) || Date.now(),
    tasks: taskRows.map(rowToTask),
    apps: Array.isArray(settings.apps) ? settings.apps : [],
    friends: friendRows.map((f) => f.friend_un),
    pm: settings.pm || { w: 25, sb: 5, lb: 15, sound: false, notify: false },
    blocking: normalizeState({
      rules: blocking.rules || [],
      schedules: blocking.schedules || [],
      // The complete client document wins over the schema-shaped copies: it is
      // what every client writes and reads, while the top-level columns exist
      // so the settings can be queried and joined server-side. Defaults for any
      // field missing from both are filled in by `normalizeState` below.
      settings: {
        ...(typeof settings.blockDuringFocus === "boolean"
          ? { blockDuringFocus: settings.blockDuringFocus }
          : {}),
        ...(blocking.settings || {}),
      },
      unblocks: {},
      focus: null,
    }),
    settingsVersion: 1,
  };
}

// ── which keys travel ─────────────────────────────────────────────────────
/** The storage keys this module knows how to push. */
export const pushable = (key) => {
  const k = String(key || "");
  return k.startsWith("u:") || k.startsWith("bd:") || k.startsWith("fs:");
};

/**
 * A cheap fingerprint of everything that actually travels to the server.
 *
 * Two things live in the profile record that must NOT be synced — the running
 * focus window and temporary unblocks — and the timer republishes the record on
 * every start and pause while the Focus screen reloads it on navigation.
 * Without this, each of those would cost a network round trip for no change.
 * Comparing only the shareable half means a pause is free and a real edit is
 * still pushed immediately.
 */
export function signature(key, value) {
  try {
    if (!value) return "null";
    if (String(key).startsWith("bd:")) return JSON.stringify(value);
    if (String(key).startsWith("fs:")) return (value || []).map((s) => s.id).join(",");
    const doc = docFromProfile(value);
    return JSON.stringify([
      doc.name, doc.email, doc.pm, doc.apps, doc.blocking,
      (value.tasks || []).map((t) => [t.id, t.title, t.due, t.pri, t.cat, t.completed, t.boardId, t.colId]),
    ]);
  } catch {
    return `unfingerprintable:${Math.random()}`;
  }
}
