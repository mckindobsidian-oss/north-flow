import { mergeActivitySnapshots } from "../shared/activity.js";
/** Fetch the complete inclusive range, rather than PostgREST's first page. */
export async function readUsageHistory(client, userId, from, to) {
  if (!client || !userId) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const query = client.from("usage_records")
      .select("day, kind, name, seconds, device_id, source, hourly").eq("user_id", userId)
      .in("kind", ["website", "app"]).gte("day", from).lte("day", to)
      .order("day").order("kind").order("name").range(offset, offset + pageSize - 1);
    let result = await query;
    // Older projects have the original four-column table. Keep the dashboard
    // usable until the additive device-source migration is applied.
    if (result.error) {
      result = await client.from("usage_records")
        .select("day, kind, name, seconds").eq("user_id", userId)
        .in("kind", ["website", "app"]).gte("day", from).lte("day", to)
        .order("day").order("kind").order("name").range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      result.data = (result.data || []).map((row) => ({ ...row, device_id: "legacy", source: "legacy" }));
    }
    const { data } = result;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Collapse per-device rows while avoiding overlap with pre-migration totals. */
export function mergeUsageSources(rows) {
  return mergeActivitySnapshots(rows);
}
