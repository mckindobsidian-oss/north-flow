import { isSystemApp } from "./activity.js";
/** Split a tracked interval at UTC midnight; usage_records are keyed by day. */
export function splitUsageInterval(host, startAt, endAt) {
  if (!host || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return [];
  const rows = [];
  for (let cursor = startAt; cursor < endAt;) {
    const nextDay = new Date(cursor);
    nextDay.setUTCHours(24, 0, 0, 0);
    const end = Math.min(endAt, nextDay.getTime());
    const seconds = (end - cursor) / 1000;
    if (seconds > 0) rows.push({ day: new Date(cursor).toISOString().slice(0, 10), host, seconds });
    cursor = end;
  }
  return rows;
}

/** Only real web pages contribute browsing time, never internal browser UI. */
export function httpHost(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, "") || null : null;
  } catch { return null; }
}

/** Only the selected page in the focused, non-idle browser contributes time. */
export function selectUsageTabs(activeTab, hostOf, since = Date.now()) {
  if (!activeTab) return [];
  const host = hostOf(activeTab.pendingUrl || activeTab.url || "");
  return host ? [{ tabId: activeTab.id, host, since }] : [];
}

/** Never backfill a browser restart, sleep, or an unobserved long gap. */
export function observedInterval(track, until, browserSession) {
  if (track?.browserSession !== browserSession || !Number.isFinite(track?.since)
    || until <= track.since || until - track.since > 90_000) return null;
  return { startAt: track.since, endAt: until };
}

export function isUsageDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  try { return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; }
  catch { return false; }
}

/** Reconcile desktop collector snapshots without counting legacy overlap twice. */
export function summarizeDesktopUsage(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    if (!row.name || row.kind !== "app" || isSystemApp(row.name)) continue;
    const value = totals.get(row.name) || { legacy: 0, devices: 0 };
    const seconds = Math.max(0, Number(row.seconds) || 0);
    if (!row.device_id || row.device_id === "legacy") value.legacy += seconds;
    else value.devices += seconds;
    totals.set(row.name, value);
  }
  return [...totals].map(([name, value]) => ({ name, seconds: Math.floor(Math.max(value.legacy, value.devices)) }))
    .filter((row) => row.seconds > 0).sort((a, b) => b.seconds - a.seconds);
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
