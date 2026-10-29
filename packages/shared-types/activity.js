// Shared reporting semantics for browser, desktop UI and future mobile clients.
export function isSystemApp(name) {
  return /^(searchapp|searchhost|searchui|startmenuexperiencehost|shellexperiencehost|lockapp|textinputhost|runtimebroker|widgets|widgetservice)(\.exe)?$/i.test(String(name || "").trim());
}

// Older collectors stored browser-internal pages as hostnames. They are not
// browsing activity; keep the original records, but exclude them from reports.
export function isInternalWebsite(name) {
  return /^(null|undefined|newtab|extensions)$/i.test(String(name || ""))
    || /^[a-p]{32}$/i.test(String(name || ""))
    || /^(chrome|edge|brave|chrome-extension|about):/i.test(String(name || ""));
}

export function splitHourlyInterval(startAt, endAt) {
  const rows = [];
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return rows;
  for (let cursor = startAt; cursor < endAt;) {
    const boundary = Math.floor(cursor / 3600000) * 3600000 + 3600000;
    const end = Math.min(endAt, boundary);
    const date = new Date(cursor);
    rows.push({ day: date.toISOString().slice(0, 10), hour: String(date.getUTCHours()), seconds: (end - cursor) / 1000 });
    cursor = end;
  }
  return rows;
}

/** Merge cumulative snapshots once per collector, then sum distinct devices. */
export function mergeActivitySnapshots(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row.name || (row.kind === "app" && isSystemApp(row.name))) continue;
    if (row.kind === "website" && isInternalWebsite(row.name)) continue;
    const key = `${row.day}:${row.kind}:${row.name}`;
    const group = groups.get(key) || { ...row, devices: new Map() };
    const device = row.device_id || "legacy";
    const previous = group.devices.get(device);
    if (!previous || Number(row.seconds) >= Number(previous.seconds)) group.devices.set(device, row);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ devices, ...row }) => {
    const hourly = {};
    let legacy = 0, total = 0;
    for (const [id, snapshot] of devices) {
      const seconds = Math.max(0, Number(snapshot.seconds) || 0);
      if (id === "legacy") legacy = seconds; else total += seconds;
      for (const [hour, value] of Object.entries(snapshot.hourly || {})) hourly[hour] = (hourly[hour] || 0) + Math.max(0, Number(value) || 0);
    }
    return { ...row, seconds: Math.max(legacy, total), hourly };
  });
}
