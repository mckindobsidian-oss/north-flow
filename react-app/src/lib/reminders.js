/**
 * NORTH — task due-date reminders (pure scheduling logic, no DOM, no storage).
 *
 * Separate from the Pomodoro-end notification on purpose: a Pomodoro
 * notification is an *event* (the timer fired once, mid-session, the user is
 * presumably present). A task reminder is *state* — a task stays due until it
 * is completed or the day passes, so the same reminder must not fire twice.
 * This module owns that decision; `focusly.jsx` owns the actual Notification.
 *
 * OFFLINE / RESTART SAFETY
 * The dedup ledger is a plain object of reminder keys → timestamp, held in
 * device storage under one key. A key is `day:taskId`, so:
 *   • restarting the app cannot re-fire today's reminder (the ledger says so);
 *   • tomorrow gets a fresh key, so a task due again reminds again;
 *   • completing or deleting a task needs no cleanup — old keys simply stop
 *     matching anything and are pruned by the caller.
 * The ledger is written by the caller and passed back in, so this module
 * stays testable and storage-agnostic.
 */

/** The local-date string a timestamp falls on (YYYY-MM-DD, device timezone). */
export const dayOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Which tasks want a reminder right now.
 *
 * A task is reminded when it is not completed AND its due date is today or
 * earlier (an overdue task still deserves its ping — silently aging out would
 * be the worst of both worlds). Future-dated tasks never appear.
 *
 * @param {Array<{id: string, due?: string, completed?: boolean}>} tasks
 * @param {string} today  local YYYY-MM-DD
 */
export function dueTasks(tasks, today) {
  return (Array.isArray(tasks) ? tasks : []).filter(
    (t) => t && !t.completed && t.due && t.due <= today
  );
}

// ── KINDS: one taxonomy for every reminder North can fire ────────────────
// Keys stay `day:taskId` so the existing dedup ledger works unchanged; the
// kind is the middle segment. Calendar events join the same ledger with
// `day:g:<gcalId>` — a `g` prefix keeps the two id spaces apart.
export const REMINDER_KINDS = ["due-today", "upcoming", "overdue", "event"];

/**
 * What a task should remind as, given the day. Priority order matters: a
 * task due today is "due-today" even if it was created weeks ago; one due
 * later is "upcoming" (fires `lead` days ahead); one past due is "overdue".
 * `remindOn` (per-task preference) can narrow this: "none" silences the task.
 */
export function reminderKindForTask(task, today, lead = 1) {
  if (!task || task.completed || !task.due) return null;
  if (task.remindOn === "none") return null;
  if (task.due === today) return "due-today";
  if (task.due > today) {
    const leadKey = dayOf(Date.parse(`${task.due}T12:00:00`) - lead * 86400000);
    return today >= leadKey ? "upcoming" : null;
  }
  return "overdue";
}

/**
 * The complete reminder plan for one tick: tasks (due-today / upcoming /
 * overdue) and optionally Google Calendar events starting today. Returns
 * unfired keys in a stable order, plus the kind of each for the caller's
 * message copy.
 *
 * @param {Array} tasks       North tasks
 * @param {Array} events      normalized Google events (lib/calendar.js shape)
 * @param {string} today      local YYYY-MM-DD
 * @param {Record<string, number>} ledger  previously-fired keys
 * @param {{leadDays?: number, includeEvents?: boolean}} opts
 */
export function buildReminderPlan(tasks, events, today, ledger = {}, opts = {}) {
  const lead = Math.max(0, Number(opts.leadDays ?? 1));
  const plan = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const kind = reminderKindForTask(t, today, lead);
    if (!kind) continue;
    const key = `${today}:${t.id}`;
    if (!ledger[key]) plan.push({ key, kind, taskId: t.id, title: t.title || "" });
  }
  if (opts.includeEvents) {
    for (const e of Array.isArray(events) ? events : []) {
      if (!e?.gcalId || e.day !== today || e.end <= Date.now()) continue;
      const key = `${today}:g:${e.gcalId}`;
      if (!ledger[key]) plan.push({ key, kind: "event", eventId: e.gcalId, title: e.title || "" });
    }
  }
  return plan;
}

/**
 * The reminder keys that still need firing this tick: due tasks the ledger
 * has not recorded for today. Returns them sorted for deterministic tests.
 *
 * @param {Array} tasks       the profile's tasks
 * @param {string} today      local YYYY-MM-DD
 * @param {Record<string, number>} ledger  previously-fired keys → timestamp
 * @returns {string[]}        unfired keys, `"<day>:<taskId>"`
 */
export function pendingReminders(tasks, today, ledger = {}) {
  return dueTasks(tasks, today)
    .map((t) => `${today}:${t.id}`)
    .filter((key) => !ledger[key])
    .sort();
}

/**
 * Fold fired keys into the ledger and prune anything older than yesterday —
 * keys only ever carry one day, so anything with a smaller day prefix is dead
 * weight (its task was completed, deleted, or the device was off for a while).
 *
 * Pruning is anchored to the `today` DATE STRING — the same day the keys are
 * built from — never to a wall-clock timestamp, so the ledger cannot disagree
 * with itself across midnight or when the caller passes a synthetic `now`.
 *
 * @param {string[]} firedKeys
 * @param {string} today
 * @param {Record<string, number>} ledger
 * @param {number} now
 * @returns {Record<string, number>} the next ledger
 */
export function recordFired(firedKeys, today, ledger = {}, now = Date.now()) {
  const next = { ...ledger };
  for (const key of firedKeys) next[key] = now;
  // Yesterday, as a YYYY-MM-DD string, derived from `today` at local noon —
  // noon keeps the arithmetic stable across DST boundaries.
  const noon = Date.parse(`${today}T12:00:00`);
  const cut = dayOf(Number.isFinite(noon) ? noon - 86400000 : now - 86400000);
  for (const key of Object.keys(next)) {
    if (key.slice(0, 10) < cut) delete next[key];
  }
  return next;
}

/**
 * Cancellation: drop every ledger entry — pending OR already-fired — whose
 * task is completed or gone, or whose calendar event no longer exists. A
 * completed task should never remind again, and an old fired entry for a
 * dead task is pure noise; the ledger is a living schedule, not an archive
 * (age-pruning in recordFired is the second, coarser half of cleanup). Cheap
 * to call on every tick, idempotent, pure.
 */
export function cancelStaleReminders(ledger, tasks, events = []) {
  const liveTasks = new Set((Array.isArray(tasks) ? tasks : []).filter((t) => !t?.completed).map((t) => t.id));
  const liveEvents = new Set((Array.isArray(events) ? events : []).map((e) => e.gcalId));
  const next = {};
  for (const [key, ts] of Object.entries(ledger || {})) {
    const rest = key.slice(11); // after "YYYY-MM-DD:"
    if (rest.startsWith("g:")) {
      if (liveEvents.has(rest.slice(2))) next[key] = ts; // keep only if event still exists
    } else if (liveTasks.has(rest)) {
      next[key] = ts;
    }
    // completed/deleted task or vanished event → entry dropped
  }
  return next;
}

/**
 * One full tick, wired the way the app calls it: compute what should fire and
 * what the ledger becomes in one call, so a caller cannot fire a key and
 * forget to record it (the duplicate-notification bug this module exists to
 * prevent).
 *
 * @returns {{ toFire: string[], nextLedger: Record<string, number> }}
 */
export function reminderTick(tasks, today, ledger, now = Date.now()) {
  const toFire = pendingReminders(tasks, today, ledger);
  return { toFire, nextLedger: recordFired(toFire, today, ledger, now) };
}
