export const STREAK_MILESTONES = [[1, "First spark"], [3, "Finding rhythm"], [7, "Week of focus"], [14, "Steady flame"], [30, "Bright month"], [100, "North star"]];
let progressWrites = Promise.resolve();
export function recordStreakDay(store, username, kind, now = new Date()) {
  if (!['focus', 'task'].includes(kind)) return Promise.reject(new Error('Unknown streak objective'));
  const operation = progressWrites.catch(() => {}).then(async () => {
    const key = `u:${username}`; const profile = await store.get(key);
    if (!profile) return null;
    const day = localDay(now);
    if (profile.streakDays?.[day]?.[kind]) return null;
    const streakDays = mergeStreakDays(profile.streakDays, { [day]: { [kind]: true } });
    await store.set(key, { ...profile, un: username, streakDays });
    return streakSummary(streakDays, now);
  });
  progressWrites = operation;
  return operation;
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function mergeStreakDays(a = {}, b = {}) {
  const result = { ...a };
  for (const [day, value] of Object.entries(b)) result[day] = { focus: Boolean(a[day]?.focus || value.focus), task: Boolean(a[day]?.task || value.task) };
  return result;
}
export function streakSummary(days = {}, now = new Date()) {
  const complete = new Set(Object.keys(days).filter((key) => days[key]?.focus && days[key]?.task));
  let best = 0, run = 0, previous = null;
  for (const day of [...complete].sort()) {
    const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() - 1);
    run = previous === localDay(date) ? run + 1 : 1;
    best = Math.max(best, run); previous = day;
  }
  const cursor = new Date(now); let current = 0;
  if (!complete.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (complete.has(localDay(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }
  return { current, best, lit: complete.has(localDay(now)), today: days[localDay(now)] || {} };
}
