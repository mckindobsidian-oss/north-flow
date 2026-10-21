import test from "node:test";
import assert from "node:assert/strict";
import { authEventUser, cachedSessionUser } from "../react-app/src/lib/auth-events.js";

test("auth events keep the app session aligned with Supabase", () => {
  const user = { id: "account-1", email: "north@example.com" };
  assert.equal(authEventUser("SIGNED_IN", { user }), user);
  assert.equal(authEventUser("TOKEN_REFRESHED", { user }), user);
  assert.equal(authEventUser("USER_UPDATED", { user }), user);
  assert.equal(authEventUser("SIGNED_OUT", null), null);
  assert.equal(authEventUser("INITIAL_SESSION", { user }), undefined);
  assert.equal(authEventUser("PASSWORD_RECOVERY", { user }), undefined);
});

test("cached account identity survives an offline app boot", () => {
  const profile = { un: "north", name: "North", tasks: [] };
  assert.deepEqual(cachedSessionUser(profile, { id: "account-1", authLinked: true }), {
    ...profile,
    id: "account-1",
    authLinked: true,
  });
  assert.deepEqual(cachedSessionUser(profile, { id: "", authLinked: true }), {
    ...profile,
    id: "",
    authLinked: false,
  });
  assert.equal(cachedSessionUser(null, { id: "account-1", authLinked: true }), null);
});
