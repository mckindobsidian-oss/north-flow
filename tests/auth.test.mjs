/**
 * NORTH — auth intent resolution (`packages/shared-types/account.js`).
 *
 * OAuth creates the auth user before the app runs, so the only way to keep
 * "Sign in" and "Sign up" honest is to enforce the declared intent after the
 * provider returns, using the one safe existence signal: the user's own
 * profile row. These tests pin the full decision table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveOAuthIntent, isKnownTheme, THEME_IDS } from "../packages/shared-types/account.js";

test("an existing account is admitted from either screen", () => {
  assert.deepEqual(resolveOAuthIntent({ accountExists: true, intent: "signin" }), { action: "admit" });
  assert.deepEqual(resolveOAuthIntent({ accountExists: true, intent: "signup" }), { action: "admit" });
});

test("a brand-new account is refused from the sign-in screen — never silently signed up", () => {
  assert.deepEqual(
    resolveOAuthIntent({ accountExists: false, intent: "signin" }),
    { action: "refuse", reason: "no-account" }
  );
});

test("a brand-new account from the sign-up screen is admitted (that is the point)", () => {
  assert.deepEqual(resolveOAuthIntent({ accountExists: false, intent: "signup" }), { action: "admit" });
});

test("a failed/unknown probe admits — a broken check must never lock people out", () => {
  // hasAccount() maps errors/offline to null-ish; only a confident `false`
  // from the sign-in intent refuses.
  assert.deepEqual(resolveOAuthIntent({ accountExists: null, intent: "signin" }), { action: "admit" });
  assert.deepEqual(resolveOAuthIntent({ accountExists: undefined, intent: "signin" }), { action: "admit" });
});

test("missing intent behaves as an ungated arrival", () => {
  assert.deepEqual(resolveOAuthIntent({ accountExists: false, intent: null }), { action: "admit" });
});

test("the appearance registry holds the built-in environments — North Glass is not an appearance", () => {
  assert.deepEqual(THEME_IDS, ["event-horizon", "violet-dusk", "obsidian-flow", "ember-horizon", "monochrome-terrain", "prism-horizon", "sculpted-bronze", "luminous-violet"]);
  assert.equal(isKnownTheme("glass"), false);
  assert.equal(isKnownTheme("light"), false);
  assert.equal(isKnownTheme("dark"), false);
  assert.equal(isKnownTheme("event-horizon"), true);
  assert.equal(isKnownTheme("violet-dusk"), true);
  assert.equal(isKnownTheme("sculpted-bronze"), true);
  assert.equal(isKnownTheme("luminous-violet"), true);
  assert.equal(isKnownTheme("north-ribbon"), false);
  assert.equal(isKnownTheme("aurora-lake"), false);
  assert.equal(isKnownTheme("ember-tide"), false);
  // The retired generic-gradient ids are no longer known, so a client that
  // still holds one keeps its local choice instead of rendering an unknown id.
  assert.equal(isKnownTheme("midnight"), false);
  assert.equal(isKnownTheme("aurora"), false);
});
