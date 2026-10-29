import test from "node:test";
import assert from "node:assert/strict";
import { newestAppearance } from "../react-app/src/lib/appearance.js";
import { signature, docFromProfile, profileFromRows } from "../react-app/src/lib/sync-map.js";
import { createSync } from "../react-app/src/lib/sync.js";

test("appearance survives profile round trips and stale device writes", async () => {
  const custom = { id: "custom", at: 200, photo: { data: "data:image/jpeg;base64,YQ==", adj: { bright: .8 } } };
  const old = { id: "sculpted-bronze", at: 100 };
  assert.equal(newestAppearance(old, custom), custom);
  const local = { un: "alice", theme: old.id, appearance: old, tasks: [] };
  assert.notEqual(signature("u:alice", local), signature("u:alice", { ...local, theme: "violet-dusk" }));
  const row = { updated_at: "2026-10-24T12:00:00Z", settings: docFromProfile({ ...local, appearance: custom, theme: "custom" }) };
  const restored = profileFromRows({ un: "alice", profileRow: row });
  assert.deepEqual(restored.appearance, custom);
  let cloud = row, conflict = false;
  const records = new Map([["u:alice", local]]);
  const client = { from(table) {
    let write, existingUpdate = false;
    const query = new Proxy({}, { get(_, key) {
      if (key === "then") return (resolve) => {
        if (table === "profiles" && write && !conflict) cloud = write;
        resolve({ data: existingUpdate ? conflict ? [] : [{ id: "account-a" }] : table === "profiles" ? cloud : [], error: null });
      };
      return (...args) => { if (key === "upsert" || key === "update") write = args[0]; if (key === "update") existingUpdate = true; return query; };
    } }); return query;
  } };
  const sync = createSync({ client, store: { get: async (key) => records.get(key), set: async (key, value) => records.set(key, value), del: async (key) => records.delete(key) } });
  sync.attach({ userId: "account-a", un: "alice" });
  assert.equal((await sync.flushProfile("alice")).ok, true);
  assert.deepEqual(cloud.settings.appearance, custom);
  assert.equal(cloud.settings.theme, "custom");
  conflict = true;
  records.set("u:alice", { ...local, appearance: { id: "violet-dusk", at: 300 }, theme: "violet-dusk" });
  assert.equal((await sync.flushProfile("alice")).ok, false);
  assert.deepEqual(cloud.settings.appearance, custom);
  assert.ok((await sync.pendingCount()).includes("u:alice"));
  sync.detach();
});
