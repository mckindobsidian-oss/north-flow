/**
 * NORTH — the unified day view model (pure).
 *
 * One definition of "what is on today": North tasks, Google Calendar events,
 * completed tasks, focus minutes and the overdue set, merged and ordered.
 * Shared by the Home screen's day view and the Focus screen's "coming up"
 * context, so the two can never disagree about today.
 */
import { eventsForDay } from "./calendar.js";

/**
 * Build today's picture.
 *
 * @param {Array} tasks      North tasks ({ id, title, due, completed, pri })
 * @param {Array} events     normalized Google events (lib/calendar.js shape)
 * @param {Object} focus     { minutes, sessions } for today
 * @param {string} today     local YYYY-MM-DD
 * @param {number} now       wall clock (ms) — injectable for tests
 * @returns {{
 *   tasks: Array, completed: Array, overdue: Array,
 *   events: Array, nextEvent: Object|null, focusMinutes: number, sessions: number,
 *   next: Array  // intermixed upcoming items, ordered by time
 * }}
 */
export function dayView(tasks, events, focus, today, now = Date.now()) {
  const list = Array.isArray(tasks) ? tasks : [];
  const due = (t) => t && t.due;
  const todays = list.filter((t) => due(t) && t.due === today);
  const completed = todays.filter((t) => t.completed);
  const overdue = list.filter((t) => due(t) && !t.completed && t.due < today);
  const open = todays.filter((t) => !t.completed);

  const evs = eventsForDay(events, today).filter((e) => e.end > now);
  const nextEvent = evs.find((e) => e.start > now) ?? null;

  // The merged "coming up" rail: open tasks (due-today, priority order) and
  // events (chronological) — each item carries a `type` so the UI can mark
  // North task vs Google event without guessing.
  const priRank = { high: 0, medium: 1, low: 2 };
  const next = [
    ...open.map((t) => ({ type: "task", id: t.id, title: t.title, pri: t.pri, at: null })),
    ...evs.map((e) => ({ type: "event", id: e.gcalId, title: e.title, at: e.start, allDay: e.allDay })),
  ].sort((a, b) => {
    if (a.at != null && b.at != null) return a.at - b.at;
    if (a.at != null) return -1; // timed things first
    if (b.at != null) return 1;
    return (priRank[a.pri] ?? 1) - (priRank[b.pri] ?? 1);
  });

  return {
    tasks: open,
    completed,
    overdue,
    events: evs,
    nextEvent,
    focusMinutes: Math.max(0, Number(focus?.minutes ?? 0)),
    sessions: Math.max(0, Number(focus?.sessions ?? 0)),
    next,
  };
}
