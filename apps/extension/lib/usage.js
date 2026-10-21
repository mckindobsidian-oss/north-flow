/** Split a tracked interval at UTC midnight; usage_records are keyed by day. */
export function splitUsageInterval(host, startAt, endAt) {
  if (!host || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return [];
  const rows = [];
  for (let cursor = startAt; cursor < endAt;) {
    const nextDay = new Date(cursor);
    nextDay.setUTCHours(24, 0, 0, 0);
    const end = Math.min(endAt, nextDay.getTime());
    const seconds = Math.floor((end - cursor) / 1000);
    if (seconds > 0) rows.push({ day: new Date(cursor).toISOString().slice(0, 10), host, seconds });
    cursor = end;
  }
  return rows;
}

/** Count the focused page plus optional audible tabs, once per hostname. */
export function selectUsageTabs(activeTab, audibleTabs, includeAudio, hostOf, since = Date.now()) {
  const tabs = includeAudio ? [...audibleTabs, ...(activeTab ? [activeTab] : [])] : (activeTab ? [activeTab] : []);
  const byHost = new Map();
  for (const tab of tabs) {
    const host = hostOf(tab.pendingUrl || tab.url || "");
    if (host && !byHost.has(host)) byHost.set(host, { tabId: tab.id, host, since });
  }
  return [...byHost.values()];
}

export function isUsageDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  try { return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; }
  catch { return false; }
}

/** Sum per-site usage over an inclusive UTC date range. */
export function aggregateUsageRange(store, from, to) {
  if (!isUsageDay(from) || !isUsageDay(to)) return null;
  const first = from <= to ? from : to;
  const last = from <= to ? to : from;
  if ((Date.parse(`${last}T00:00:00.000Z`) - Date.parse(`${first}T00:00:00.000Z`)) / 86400000 > 3660) return null;
  const totals = new Map();
  let days = 0;
  for (const cursor = new Date(`${first}T00:00:00.000Z`); cursor.toISOString().slice(0, 10) <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    days += 1;
    for (const [host, seconds] of Object.entries(store?.[day] || {})) {
      const amount = Math.max(0, Number(seconds) || 0);
      if (host && amount) totals.set(host, (totals.get(host) || 0) + amount);
    }
  }
  return {
    from: first,
    to: last,
    days,
    usage: [...totals].map(([host, seconds]) => ({ host, seconds: Math.floor(seconds) }))
      .sort((a, b) => b.seconds - a.seconds || a.host.localeCompare(b.host)),
  };
}
