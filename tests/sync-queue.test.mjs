import test from "node:test";
import assert from "node:assert/strict";
import { createSync } from "../react-app/src/lib/sync.js";
import { defaultBlocking, upsertUsageLimit } from "../packages/shared-types/blocking.js";
import { applyAccountBlocking } from "../apps/extension/lib/account-merge.js";
import { mergeActivitySnapshots } from "../packages/shared-types/activity.js";

function fixture() {
  const records = new Map();
  const writes = [];
  const store = {
    get: async (key) => records.get(key),
    set: async (key, value) => { records.set(key, value); },
    del: async (key) => { records.delete(key); },
  };
  const client = { from(table) {
    const query = new Proxy({}, { get(_, method) {
      if (method === "then") return (resolve) => resolve({ data: null, error: null });
      return (...args) => {
        if (method === "upsert") writes.push({ table, row: args[0] });
        return query;
      };
    } });
    return query;
  } };
  return { records, store, writes, client };
}

test("legacy internal browser pages are excluded without removing real sites", () => {
  const rows = ["null", "newtab", "extensions", "abcdefghijklmnopabcdefghijklmnop", "supabase.com", "localhost"]
    .map((name) => ({ kind: "website", day: "2026-10-23", name, seconds: 10 }));
  assert.deepEqual(mergeActivitySnapshots(rows).map((row) => row.name), ["supabase.com", "localhost"]);
});

test("queued limits survive session restore and reach the extension document", async () => {
  const f = fixture();
  const blocking = upsertUsageLimit(defaultBlocking(), { id: "cap", kind: "website", target: "example.com", mode: "daily", dailyLimitMinutes: 20 });
  f.records.set("u:alice", { un: "alice", blocking, tasks: [] });
  f.records.set("north:syncq:account-a", ["u:alice"]);
  const sync = createSync(f);
  sync.attach({ userId: "account-a", un: "alice" });
  assert.deepEqual(await sync.pendingCount(), ["u:alice"]);
  assert.equal((await sync.flush()).ok, true);
  const profile = f.writes.find((write) => write.table === "profiles").row;
  assert.equal(profile.settings.blocking.usageLimits[0].dailyLimitMinutes, 20);
  const adopted = applyAccountBlocking(defaultBlocking(), profile.settings);
  assert.equal(adopted.state.usageLimits[0].target, "example.com");
  assert.deepEqual(await sync.pendingCount(), []);
});

test("concurrent enqueues do not lose keys or reveal another account's queue", async () => {
  const f = fixture();
  const sync = createSync(f);
  sync.attach({ userId: "account-a", un: "alice" });
  sync.afterWrite("u:alice"); sync.afterWrite("fs:alice:2026-10-23");
  assert.equal((await sync.pendingCount()).length, 2);
  sync.attach({ userId: "account-b", un: "bob" });
  assert.deepEqual(await sync.pendingCount(), []);
  sync.attach({ userId: "account-a", un: "alice" });
  assert.equal((await sync.pendingCount()).length, 2);
  sync.detach();
});

test("upgrade retains only this username's legacy pending edits and does not replay acknowledged entries", async () => {
  const f = fixture();
  f.records.set("north:syncq", ["u:alice", "u:bob"]);
  f.records.set("u:alice", { un: "alice", blocking: defaultBlocking(), tasks: [] });
  const sync = createSync(f);
  sync.attach({ userId: "account-a", un: "alice" });
  assert.deepEqual(await sync.pendingCount(), ["u:alice"]);
  assert.equal((await sync.flush()).ok, true);
  assert.deepEqual(await sync.pendingCount(), []);
  assert.deepEqual(f.records.get("north:syncq"), ["u:alice", "u:bob"]);
});
