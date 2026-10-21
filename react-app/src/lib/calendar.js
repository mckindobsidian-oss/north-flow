/**
 * NORTH — Google Calendar event normalization + local cache (pure module).
 *
 * The Edge Function returns raw Google Calendar API items; this module is the
 * only place that understands their shape. Pure, so it is unit-testable and
 * both the Calendar UI and the Focus screen can share one definition of
 * "a Google event".
 *
 * CACHE CONTRACT
 * The cache is the device's last successful sync (`gcal:<un>` key): an array
 * of normalized events plus the fetch timestamp. Offline reads come straight
 * from it; a failed refresh must never clear it (graceful offline behavior).
 * Cancellation propagates through tombstones: a cancelled event arrives as
 * { gcalId, cancelled: true }, the merge deletes it, and the merged cache
 * never contains tombstones. The sync is idempotent — every event is keyed
 * by Google's stable event id, so repeated syncs never duplicate.
 */
import { isUuid } from "./sync-map.js";

/** True when a Google event occupies a whole day (or several). */
export const isAllDay = (ev) => Boolean(ev?.start?.date) && !ev?.start?.dateTime;

/** Google's stable event id (recurring instances get stable instance ids). */
export const eventId = (ev) => String(ev?.id ?? "");

/** A cancelled/deleted event (series cancellations, instance cancels). */
export const isCancelled = (ev) => ev?.status === "cancelled";

/** Local YYYY-MM-DD for a timestamp — the key North days are grouped by. */
export const dayOfTs = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Normalize one raw Google event into North's display shape.
 *
 * Shape: { gcalId, title, start, end, allDay, day, location, meet? } —
 * `day` is the local day key the UI groups by; all-day events get the UTC
 * date Google provides (a whole day has no better local claim) and are
 * flagged so the UI can render them without a clock time.
 *
 * CANCELLED events return a TOMBSTONE — { gcalId, cancelled: true } — rather
 * than null, because the merge needs to learn about deletions: Google stops
 * sending a deleted event, so the only way the cache can drop it is an
 * explicit marker. Tombstones never reach the UI (every reader filters them).
 * Malformed entries (no id, no usable time) are null and simply skipped.
 */
export function normalizeEvent(ev) {
  if (!ev || !eventId(ev)) return null;
  if (isCancelled(ev)) return { gcalId: eventId(ev), cancelled: true };
  const allDay = isAllDay(ev);
  const startTs = allDay
    ? Date.parse(`${ev.start.date}T00:00:00`)
    : Date.parse(ev.start?.dateTime ?? "");
  const endTs = allDay
    ? Date.parse(`${ev.end?.date ?? ev.start.date}T00:00:00`)
    : Date.parse(ev.end?.dateTime ?? "");
  if (!Number.isFinite(startTs)) return null;
  const title = String(ev.summary ?? "").trim() || "(untitled event)";
  return {
    gcalId: eventId(ev),
    title: title.slice(0, 300),
    start: startTs,
    end: Number.isFinite(endTs) && endTs > startTs ? endTs : startTs + 3600000,
    allDay,
    day: allDay ? String(ev.start.date) : dayOfTs(startTs),
    location: ev.location ? String(ev.location).slice(0, 200) : undefined,
    meet: typeof ev.hangoutLink === "string" ? ev.hangoutLink : undefined,
  };
}

/**
 * Normalize a whole Google response. Malformed entries are dropped; cancelled
 * ones are carried as tombstones so the merge can apply the deletion.
 */
export function normalizeEvents(items) {
  const out = new Map();
  for (const ev of Array.isArray(items) ? items : []) {
    const n = normalizeEvent(ev);
    if (n) out.set(n.gcalId, n); // dedupe by Google's stable id
  }
  return [...out.values()]
    .sort((a, b) => (a.cancelled ? 1 : b.cancelled ? -1 : a.start - b.start));
}

/**
 * Merge newly fetched events into the cached set.
 *
 * Idempotent: the same fetch merged twice yields the same set. A tombstone
 * in `fetched` DELETES the id from the result — that is how a cancellation
 * or deletion propagates (Google stops sending live data for it). The merged
 * output never contains tombstones. An empty/error fetch must not be
 * persisted by the caller, so the previous cache survives offline failures.
 */
export function mergeCache(cached, fetched) {
  const map = new Map((Array.isArray(cached) ? cached : []).filter((e) => !e.cancelled).map((e) => [e.gcalId, e]));
  for (const e of Array.isArray(fetched) ? fetched : []) {
    if (e.cancelled) map.delete(e.gcalId);
    else map.set(e.gcalId, e);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/** Events on one local day key. Tombstones never surface. */
export const eventsForDay = (cache, day) =>
  (Array.isArray(cache) ? cache : []).filter((e) => e.day === day && !e.cancelled);

/** Upcoming events from `now`, optionally capped. */
export function upcomingEvents(cache, now = Date.now(), limit = 3) {
  return (Array.isArray(cache) ? cache : [])
    .filter((e) => !e.cancelled && e.end > now)
    .slice(0, limit);
}

/** The next event starting after `now` (or null). */
export const nextEvent = (cache, now = Date.now()) =>
  (Array.isArray(cache) ? cache : []).find((e) => !e.cancelled && e.start > now) ?? null;

/** True when the record is a Google event and not a North task. */
export const isGoogleEvent = (rec) => Boolean(rec?.gcalId) && !isUuid(rec?.gcalId);

/** Cache envelope for the `gcal:<un>` key. */
export const saveCache = (events, fetchedAt = Date.now()) => ({
  events: Array.isArray(events) ? events : [],
  fetchedAt,
});
export const loadCache = (raw) =>
  raw && Array.isArray(raw.events) ? raw : { events: [], fetchedAt: 0 };

/** A compact "9:00–10:00" / "all day" label for the UI. */
export function eventTimeLabel(ev) {
  if (ev.allDay) return "All day";
  const t = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const sameDay = dayOfTs(ev.start) === dayOfTs(ev.end - 1);
  return sameDay ? `${t(ev.start)}–${t(ev.end)}` : `${t(ev.start)} · multi-day`;
}
