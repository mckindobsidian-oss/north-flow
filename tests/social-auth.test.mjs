import test from "node:test";
import assert from "node:assert/strict";
import { createSync } from "../react-app/src/lib/sync.js";

test("friend actions recover a real session before sync attaches, but never accept a local identity", async () => {
  let authenticated = false;
  const requests = [];
  const records = new Map();
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "account-a" } : null } }) },
    from(table) {
      const query = new Proxy({}, { get(_, method) {
        if (method === "then") return (resolve) => resolve({ data: table === "profiles" ? { un: "alice", settings: {} } : [], error: null });
        return () => query;
      } });
      return query;
    },
    rpc: async (method, args) => { requests.push({ method, args }); return { data: "pending" }; },
  };
  const sync = createSync({ client, store: { get: async (key) => records.get(key), set: async (key, value) => records.set(key, value), del: async (key) => records.delete(key) } });
  await assert.rejects(sync.friendAction("bob", "request"), /Sign in to your North account/);
  assert.equal(requests.length, 0);
  authenticated = true;
  assert.equal(await sync.friendAction("bob", "request"), "pending");
  assert.deepEqual(requests[0], { method: "friend_action", args: { p_requester_un: "bob", p_action: "request" } });
  assert.equal(sync.ready(), true);
});
