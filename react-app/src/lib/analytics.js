/**
 * NORTH — productivity analytics (pure, real data only).
 *
 * Every number here is derived from records that actually exist: raw focus
 * sessions (`fs:<un>:<date>`, the same source of truth the heatmap and the
 * database trigger use) and the task list. Nothing is estimated, interpolated
 * or invented — an empty day is a zero, and fields without data are simply
 * absent from the summary.
 *
 * The task↔focus relationship uses the session `taskId` links (Step 2's
 * feature), so "time by task" is real recorded time, not a heuristic.
 */
import { dayOfTs } from "./calendar.js";

/** Hidden usage is a display/reporting preference, not deleted tracking data. */
export function isHiddenUsageSite(host, hiddenSites = []) {
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  const candidate = normalize(host);
  return Boolean(candidate && (Array.isArray(hiddenSites) ? hiddenSites : []).some((site) => {
    const hidden = normalize(site);
    return hidden && (candidate === hidden || candidate.endsWith(`.${hidden}`));
  }));
}

/**
 * Seconds actually focused in one session record (focus phase only).
 * A skipped session still banks its real partial time — the timer itself
 * banks `actual` on skip, so analytics must agree with what was recorded,
 * not with the completed flag.
 */
const focusedSecs = (s) =>
  s?.type === "focus" ? Math.max(0, Number(s.actual) || 0) : 0;

/**
 * Build the analytics summary.
 *
 * @param {Object} sessionsByDay  map "YYYY-MM-DD" → session record arrays
 * @param {Array}  tasks          the full task list
 * @param {number} now            wall clock (ms), injectable
 * @param {Object} opts           { weeks: 4 } — the trend window
 */
export function analyticsSummary(sessionsByDay, tasks, now = Date.now(), opts = {}) {
  const weeks = Math.max(1, Number(opts.weeks ?? 4));
  const today = dayOfTs(now);
  const windowStart = dayOfTs(now - (weeks * 7 - 1) * 86400000);

  // Aggregate the window from real records.
  let totalSecs = 0, totalSessions = 0, activeDays = 0;
  const perDay = [];   // [{ day, secs, sessions }] oldest → newest, 0s included
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const day = dayOfTs(now - i * 86400000);
    const recs = sessionsByDay?.[day] ?? [];
    let secs = 0, count = 0;
    for (const r of Array.isArray(recs) ? recs : []) {
      if (r?.type === "focus") count += 1; // every focus record is a session
      const s = focusedSecs(r);
      if (s > 0) secs += s;
    }
    totalSecs += secs; totalSessions += count;
    if (secs > 0) activeDays += 1;
    perDay.push({ day, secs, sessions: count });
  }

  // Focus time per task — only linked sessions count.
  const byTask = new Map();
  for (const recs of Object.values(sessionsByDay ?? {})) {
    for (const r of Array.isArray(recs) ? recs : []) {
      const secs = focusedSecs(r);
      if (secs > 0 && r.taskId) {
        const e = byTask.get(r.taskId) ?? { taskId: r.taskId, secs: 0, sessions: 0 };
        e.secs += secs; e.sessions += 1;
        byTask.set(r.taskId, e);
      }
    }
  }
  const taskTitles = new Map((Array.isArray(tasks) ? tasks : []).map((t) => [t.id, t.title]));
  const topTasks = [...byTask.values()]
    .map((e) => ({ ...e, title: taskTitles.get(e.taskId) ?? "(deleted task)", minutes: Math.round(e.secs / 60) }))
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 5);

  // Tasks created within the window (no `at` timestamp → always counted; the
  // window is a reporting frame, not a data filter, for legacy records).
  const tasksInWindow = (Array.isArray(tasks) ? tasks : []).filter((t) => !t.at || t.at >= Date.parse(`${windowStart}T00:00:00`));

  // Streak: consecutive focus days ending today or yesterday (same rule the
  // server's current_streak uses, computed locally from real records).
  const focused = new Set(perDay.filter((d) => d.secs > 0).map((d) => d.day));
  let streak = 0;
  const cursor = new Date(now);
  if (!focused.has(dayOfTs(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (focused.has(dayOfTs(cursor.getTime()))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }

  const weekSecs = perDay.slice(-7).reduce((a, d) => a + d.secs, 0);
  const prevWeekSecs = perDay.slice(-14, -7).reduce((a, d) => a + d.secs, 0);

  return {
    window: { weeks, start: windowStart, end: today },
    totals: {
      focusMinutes: Math.round(totalSecs / 60),
      sessions: totalSessions,
      activeDays,
      avgPerActiveDay: activeDays ? Math.round(totalSecs / activeDays / 60) : 0,
    },
    weekTrend: {
      thisWeekMinutes: Math.round(weekSecs / 60),
      lastWeekMinutes: Math.round(prevWeekSecs / 60),
      // Percent change, null when there is no baseline — never a fake 0%.
      changePct: prevWeekSecs > 0 ? Math.round(((weekSecs - prevWeekSecs) / prevWeekSecs) * 100) : null,
    },
    streak,
    tasks: {
      total: tasksInWindow.length,
      completed: tasksInWindow.filter((t) => t.completed).length,
      open: tasksInWindow.filter((t) => !t.completed).length,
    },
    perDay,
    topTasks,
  };
}

/**
 * Distraction/blocking statistics — from real usage records only.
 *
 * The extension (and later the desktop client) posts per-domain seconds per
 * day to `usage_records` (kind 'website'). This summary answers the only
 * question that data honestly can: where did browsing time actually go, and
 * how much of it landed on domains the user has chosen to block? Nothing is
 * inferred about pages or sessions — records carry domains and durations, so
 * the answer stays at that level. No records → an empty, honest summary.
 *
 * @param {Array} usageRows  [{ day: "YYYY-MM-DD", name: "youtube.com", seconds }]
 * @param {Array} blockRules the account's website rules ([{ target, enabled }])
 * @param {string} today     "YYYY-MM-DD" — records on/after this day are excluded
 *                            (a day is only counted once it is over)
 */
export function distractionSummary(usageRows, blockRules = [], today = null, hiddenSites = []) {
  const rows = (Array.isArray(usageRows) ? usageRows : []).filter(
    (r) => r && typeof r.name === "string" && r.name.trim() !== "" &&
      Number.isFinite(Number(r.seconds))
  );
  if (!rows.length) return { available: false, days: 0, totalMinutes: 0, blockedMinutes: 0, topDomains: [] };

  const blockedHosts = new Set(
    (Array.isArray(blockRules) ? blockRules : [])
      .filter((r) => r && r.kind === "website" && r.enabled !== false && typeof r.target === "string")
      .map((r) => String(r.target).toLowerCase().replace(/^www\./, ""))
  );
  const cutoff = typeof today === "string" ? today : "9999-12-31";

  let totalSecs = 0, blockedSecs = 0;
  const days = new Set();
  const byDomain = new Map();
  for (const r of rows) {
    const day = String(r.day || "");
    if (cutoff !== "9999-12-31" && day >= cutoff) continue; // today is still open
    const secs = Math.max(0, Math.floor(Number(r.seconds)));
    if (secs <= 0) continue;
    if (typeof r.name !== "string" || r.name.trim() === "") continue;
    const host = r.name.trim().toLowerCase().replace(/^www\./, "");
    if (isHiddenUsageSite(host, hiddenSites)) continue;
    days.add(day);
    totalSecs += secs;
    if (blockedHosts.has(host)) blockedSecs += secs;
    const e = byDomain.get(host) ?? { domain: host, seconds: 0 };
    e.seconds += secs;
    byDomain.set(host, e);
  }

  const topDomains = [...byDomain.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
    .map((e) => ({ domain: e.domain, minutes: Math.round(e.seconds / 60) }));

  // Rows existed but none survived filtering (all zero/negative, or every
  // day still open) — that is also "no data", not a zero measurement.
  if (totalSecs <= 0 || days.size === 0) {
    return { available: false, days: 0, totalMinutes: 0, blockedMinutes: 0, topDomains: [] };
  }

  return {
    available: true,
    days: days.size,
    totalMinutes: Math.round(totalSecs / 60),
    blockedMinutes: Math.round(blockedSecs / 60),
    topDomains,
  };
}
