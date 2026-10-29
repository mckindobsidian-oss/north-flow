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

// The two task scales that have a CHECK constraint server-side. Kept here (not
// inline) so `taskToRow` and `signature` can never disagree about what counts
// as a valid value — a mismatch would push a row the schema rejects, or hide a
// real edit from the fingerprint.
const TASK_PRIORITIES = ["low", "medium", "high"];
const TASK_DIFFICULTIES = ["easy", "medium", "hard"];

/** Difficulty, read the way the app reads it: a missing one means medium. */
const normalizedDiff = (t) => (TASK_DIFFICULTIES.includes(t?.diff) ? t.diff : "medium");

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
    priority: TASK_PRIORITIES.includes(task.pri) ? task.pri : "medium",
    // Difficulty is its OWN scale, not a synonym for priority, and description
    // is free text. Both arrive with migration 005; a project that has not
    // applied it rejects these columns, which is what pushTasks'
    // strip-and-retry fallback exists for.
    difficulty: normalizedDiff(task),
    category: task.cat || "Personal",
    description: task.desc ? String(task.desc).slice(0, 2000) : null,
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
  // Same rule for the two fields migration 005 adds: absent when the row has
  // nothing to say. `diffOf()` downstream already reads a missing difficulty as
  // "medium" and the row only renders a description when one is present, so a
  // pre-005 row behaves exactly like a legacy local record.
  if (TASK_DIFFICULTIES.includes(row.difficulty)) task.diff = row.difficulty;
  if (row.description) task.desc = row.description;
  return task;
}

/**
 * Carry local-only task metadata across a pull.
 *
 * `pull()` replaces the local profile WHOLESALE, and a project that has not
 * applied migration 005 has no difficulty/description columns at all. Combined,
 * those two facts meant every sync silently erased the difficulty and
 * description a user had typed — the fields came back from the server absent,
 * overwriting the local values. That is data loss, not a display glitch.
 *
 * The rule: when the pulled record says nothing about a field, the local value
 * survives; when the server HAS a value, the server wins, because it is the
 * shared record. Once migration 005 is applied the server always has a value,
 * so this becomes a no-op and the server is authoritative. Tasks only present
 * locally (deleted on another device) are NOT resurrected — the result is built
 * from the pulled list, so deletions still propagate.
 *
 * Pure, so `tests/sync.test.mjs` pins the rule instead of trusting it.
 */
export function keepLocalTaskMeta(pulled, local) {
  const prev = new Map((Array.isArray(local) ? local : []).map((t) => [t.id, t]));
  return (Array.isArray(pulled) ? pulled : []).map((t) => {
    const was = prev.get(t.id);
    if (!was) return t;
    const next = { ...t };
    // `in` rather than a truthiness test: an explicit empty description from
    // the server is a real value and must not be replaced by a stale local one.
    if (!("diff" in next) && was.diff) next.diff = was.diff;
    if (!("desc" in next) && was.desc) next.desc = was.desc;
    return next;
  });
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
    // The task this session worked on, when one was chosen. Only a real uuid
    // can satisfy the foreign key; anything else (legacy ids, "none") pushes
    // as null — an unlinked session, exactly like before this field existed.
    task_id: isUuid(session.taskId) ? session.taskId : null,
  };
}

export function rowToSession(row) {
  const s = {
    id: row.id,
    type: row.phase,
    start: Date.parse(row.started_at),
    end: Date.parse(row.ended_at),
    planned: row.planned_s,
    actual: row.actual_s,
    completed: Boolean(row.completed),
  };
  // Absent key, not an empty one: the app tests `session.taskId`.
  if (row.task_id) s.taskId = row.task_id;
  return s;
}

// ── profile document ──────────────────────────────────────────────────────
/**
 * The shareable half of a profile record, stored in `profiles.settings`.
 *
 * Rules, schedules and settings always travel. Temporary unblocks never do —
 * they are expiring pauses, and syncing them would let one device hold another
 * device's enforcement open for a reason that no longer exists (see SYNC.md).
 *
 * The RUNNING FOCUS WINDOW travels, and that is the point: Focus Mode started
 * here has to actually block sites in the browser, and the extension is a
 * client of this same document. It is written only by the client running the
 * timer and only *enforced* by the clients that can — see
 * `apps/extension/lib/account-merge.js` for the consuming side.
 */
export function docFromProfile(profile) {
  const b = normalizeState(profile.blocking || defaultBlocking());
  return {
    name: profile.name || "",
    email: profile.email || "",
    apps: Array.isArray(profile.apps) ? profile.apps : [],
    hiddenUsageSites: Array.isArray(profile.hiddenUsageSites) ? profile.hiddenUsageSites : [],
    pm: profile.pm || {},
    appearance: profile.appearance || null,
    streakDays: profile.streakDays || {},
    // Account theme — an ENVIRONMENT id (one of the five built-in wallpapers,
    // "custom", or a registered future id). Absent on records written before
    // themes synced, and possibly one of the retired generic-gradient ids on
    // older records — the caller decides what that means (keep the device's
    // current choice) rather than forcing a default. Unknown ids are stored
    // verbatim, never applied.
    ...(profile.theme ? { theme: profile.theme } : {}),
    blocking: { rules: b.rules, usageLimits: b.usageLimits, schedules: b.schedules, settings: b.settings, focus: b.focus ?? null },
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
    hiddenUsageSites: Array.isArray(settings.hiddenUsageSites) ? settings.hiddenUsageSites : [],
    // The account's theme (environment id), verbatim from settings.jsonb.
    // Kept even when this build can't render the id — an older client must
    // not silently discard a choice a newer one made.
    ...(settings.theme ? { theme: settings.theme } : {}),
    friends: friendRows.map((f) => f.friend_un),
    pm: settings.pm || { w: 25, sb: 5, lb: 15, sound: false, notify: false },
    appearance: settings.appearance || null,
    streakDays: settings.streakDays || {},
    blocking: normalizeState({
      rules: blocking.rules || [],
      usageLimits: blocking.usageLimits || [],
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
 * Temporary unblocks live in the profile record but must NOT be synced, and the
 * timer republishes the record on every start and pause while the Focus screen
 * reloads it on navigation. Comparing only the shareable half means a local
 * pause is free, while a real edit — including starting or ending a focus
 * session, which the extension needs — is pushed immediately.
 */
export function signature(key, value) {
  try {
    if (!value) return "null";
    if (String(key).startsWith("bd:")) return JSON.stringify(value);
    if (String(key).startsWith("fs:")) return (value || []).map((s) => s.id).join(",");
    const doc = docFromProfile(value);
    return JSON.stringify([
      doc.name, doc.email, doc.pm, doc.apps, doc.hiddenUsageSites, doc.blocking, doc.theme, doc.appearance, doc.streakDays,
      // Difficulty and description MUST be in here: this fingerprint decides
      // whether a task is pushed at all, so leaving them out would mean editing
      // only one of them pushed nothing and the change stayed on one device.
      // Both are normalized exactly as `taskToRow` normalizes them, so a legacy
      // record (no `diff`) does not look "changed" the moment it is read back.
      (value.tasks || []).map((t) => [
        t.id, t.title, t.due, t.pri, t.cat, t.completed, t.boardId, t.colId,
        normalizedDiff(t), t.desc || "",
      ]),
    ]);
  } catch {
    return `unfingerprintable:${Math.random()}`;
  }
}
