import test from "node:test";
import assert from "node:assert/strict";
import { createSync } from "../react-app/src/lib/sync.js";

test("Realtime filters by owner and ignores events after account disconnect", async () => {
  const handlers = [];
  const events = [];
  let removed = 0;
  let subscriptionStatus;
  const channel = {
    on(type, filter, callback) { handlers.push({ type, filter, callback }); return this; },
    subscribe(callback) { subscriptionStatus = callback; return this; },
  };
  const sync = createSync({
    store: { del: async () => {}, set: async () => {} },
    client: { channel: () => channel, removeChannel: async () => { removed += 1; } },
  });
  sync.attach({ userId: "account-a", un: "alice" });
  assert.equal(sync.startRealtime((event) => events.push(event)), true);
  assert.equal(handlers[0].filter.filter, "id=eq.account-a");
  assert.equal(handlers[1].filter.filter, "user_id=eq.account-a");
  subscriptionStatus("SUBSCRIBED");
  assert.deepEqual(events.pop(), { table: "profiles" });
  handlers[1].callback();
  assert.deepEqual(events, [{ table: "usage_records" }]);
  handlers[0].callback();
  sync.detach();
  handlers[1].callback();
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(events.length, 1);
  assert.equal(removed, 1);
});
