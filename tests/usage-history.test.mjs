import test from "node:test";
import assert from "node:assert/strict";
import { readUsageHistory, mergeUsageSources } from "../react-app/src/lib/usage-history.js";

test("usage history includes later pages and scopes the query to the account and dates", async () => {
  const requests = [];
  const records = Array.from({ length: 1001 }, (_, index) => ({ name: `site${index}.example`, seconds: 1, device_id: "device-a", source: "extension" }));
  const client = { from(table) {
    const request = { table, filters: [] };
    requests.push(request);
    const query = {
      select() { return query; },
      eq(...args) { request.filters.push(args); return query; },
      in() { return query; },
      gte(...args) { request.filters.push(args); return query; },
      lte(...args) { request.filters.push(args); return query; },
      order() { return query; },
      range(from, to) { return Promise.resolve({ data: records.slice(from, to + 1), error: null }); },
    };
    return query;
  } };
  const result = await readUsageHistory(client, "account-a", "2026-10-01", "2026-10-21");
  assert.equal(result.reduce((sum, row) => sum + row.seconds, 0), 1001);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].filters, [["user_id", "account-a"], ["day", "2026-10-01"], ["day", "2026-10-21"]]);
});

test("usage sources sum distinct devices and do not double-count legacy overlap", () => {
  const rows = mergeUsageSources([
    { day: "2026-10-21", kind: "website", name: "example.com", seconds: 80, device_id: "legacy" },
    { day: "2026-10-21", kind: "website", name: "example.com", seconds: 50, device_id: "browser-a" },
    { day: "2026-10-21", kind: "website", name: "example.com", seconds: 70, device_id: "browser-b" },
    { day: "2026-10-21", kind: "app", name: "Editor", seconds: 12, device_id: "desktop-a" },
    { day: "2026-10-21", kind: "app", name: "Editor", seconds: 8, device_id: "desktop-b" },
  ]);
  assert.equal(rows.find((row) => row.name === "example.com").seconds, 120);
  assert.equal(rows.find((row) => row.name === "Editor").seconds, 20);
});
