import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileIntegration } from "../react-app/src/lib/integration-state.js";

test("failed or unavailable probes cannot fabricate or revoke a connection", () => {
  for (const connected of [false, true]) {
    const cache = { connected, events: [{ id: "event" }], fetchedAt: 123 };
    for (const status of [{ error: "offline", connected: false }, { unavailable: true }, null]) {
      assert.equal(reconcileIntegration(cache, status), cache);
    }
  }
});
test("confirmed disconnect clears events; confirmed connection preserves cache", () => {
  const cache = { connected: false, email: null, events: [{ id: "event" }], fetchedAt: 123 };
  assert.deepEqual(reconcileIntegration(cache, { connected: false }), { connected: false, email: null, events: [], fetchedAt: 0 });
  assert.deepEqual(reconcileIntegration(cache, { connected: true, email: "test@example.com" }), { ...cache, connected: true, email: "test@example.com" });
});
