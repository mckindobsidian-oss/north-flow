/**
 * NORTH — distraction/blocking statistics over real usage records.
 *
 * The contract being pinned: domains and durations only (never paths), no
 * invented numbers (no records → available:false), the in-progress day is
 * excluded, and "blocked" is decided solely by the account's own enabled
 * website rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { distractionSummary } from "../react-app/src/lib/analytics.js";

const TODAY = "2026-09-26";

const rules = [
  { kind: "website", target: "youtube.com", enabled: true },
  { kind: "website", target: "www.reddit.com", enabled: true }, // www. must normalize away
  { kind: "app", target: "Steam", enabled: true }, // app rules never count here
  { kind: "website", target: "twitch.tv", enabled: false }, // disabled → not "blocked"
];

test("no records → an honest, empty summary (available:false)", () => {
  const d = distractionSummary([], rules, TODAY);
  assert.equal(d.available, false);
  assert.equal(d.totalMinutes, 0);
  assert.deepEqual(d.topDomains, []);
});

test("blocked vs unblocked minutes, with www. and case normalization", () => {
  const rows = [
    { day: "2026-09-24", name: "youtube.com", seconds: 600 },     // blocked → 10m
    { day: "2026-09-24", name: "www.YouTube.com", seconds: 300 }, // blocked → 5m
    { day: "2026-09-24", name: "github.com", seconds: 1200 },     // unblocked → 20m
    { day: "2026-09-25", name: "reddit.com", seconds: 1800 },     // blocked (www rule) → 30m
    { day: "2026-09-25", name: "twitch.tv", seconds: 900 },       // disabled rule → unblocked 15m
  ];
  const d = distractionSummary(rows, rules, TODAY);
  assert.equal(d.available, true);
  assert.equal(d.days, 2);
  assert.equal(d.totalMinutes, 80);
  assert.equal(d.blockedMinutes, 45);
  assert.equal(d.topDomains[0].domain, "reddit.com");
  assert.equal(d.topDomains[0].minutes, 30);
});

test("hidden sites are removed from browsing totals and top domains without changing rules", () => {
  const rows = [
    { day: "2026-09-24", name: "video.example.com", seconds: 600 },
    { day: "2026-09-24", name: "news.example.net", seconds: 300 },
  ];
  const summary = distractionSummary(rows, rules, TODAY, ["example.com"]);
  assert.equal(summary.totalMinutes, 5);
  assert.equal(summary.topDomains.length, 1);
  assert.equal(summary.topDomains[0].domain, "news.example.net");
});

test("the in-progress day is excluded — a day counts only once it is over", () => {
  const rows = [
    { day: "2026-09-25", name: "youtube.com", seconds: 600 },
    { day: TODAY, name: "youtube.com", seconds: 9999 }, // still open → excluded
  ];
  const d = distractionSummary(rows, rules, TODAY);
  assert.equal(d.days, 1);
  assert.equal(d.totalMinutes, 10);
});

test("zero/negative seconds and malformed rows are ignored, never invented", () => {
  const rows = [
    { day: "2026-09-24", name: "youtube.com", seconds: 0 },
    { day: "2026-09-24", name: "youtube.com", seconds: -5 },
    { day: "2026-09-24", name: 42, seconds: 100 },
    { day: "2026-09-24", seconds: 100 },
    null,
  ];
  const d = distractionSummary(rows, rules, TODAY);
  assert.equal(d.available, false);
});
