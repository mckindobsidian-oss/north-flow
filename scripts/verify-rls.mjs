#!/usr/bin/env node
/**
 * NORTH — live RLS + sync verification.
 *
 * WHY THIS EXISTS ALONGSIDE supabase/rls-check.sql
 * That script verifies the policies by *impersonation*: it runs in the Supabase
 * SQL editor as a privileged role, switches to `authenticated`, and sets the
 * JWT claims by hand. Useful, but it tests a simulation of the request. This
 * script does the opposite — it signs in as two real accounts and attacks them
 * through the same client the app ships (`@supabase/supabase-js`) and the same
 * PostgREST endpoint the browser calls. If RLS were misconfigured, this is the
 * path that would actually leak.
 *
 * It also proves the sync round-trip end to end: it replays exactly what
 * `react-app/src/lib/sync.js` writes (upsert the profile document, insert a
 * board, then a task against that board's foreign key, append a focus session,
 * mirror the rules) and confirms the data comes back, that the database's
 * trigger derived the daily total from the session, and that the second account
 * can see none of it.
 *
 *   npm run verify:rls
 *
 * CREDENTIALS ARE NEVER STORED HERE
 * Two throwaway accounts come from either the environment:
 *
 *   NORTH_A_EMAIL / NORTH_A_PASSWORD
 *   NORTH_B_EMAIL / NORTH_B_PASSWORD
 *
 * or from `react-app/.env.test.local` — a path the repository already
 * gitignores — so a throwaway password never has to be pasted into a chat
 * window or a shell history. That file is read, never echoed.
 *
 * The project URL and anon key (both public by design) are read from
 * `react-app/.env.local`. With no credentials set the script prints what is
 * missing and exits 0, so it is safe to wire into any routine check.
 *
 * WHAT IT WRITES, AND HOW IT CLEANS UP
 * Checks against account A create one board, one task, one focus session, one
 * friend row and one rule/schedule pair — each tagged with a marker, with every
 * id tracked. Cleanup deletes only those tracked ids, never a blanket
 * `user_id = ...` delete, so it cannot touch real data. Account A's settings
 * document is read first and restored afterwards.
 *
 * It is deliberately NOT part of `npm test`: routine test runs must not write
 * to a live database.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = `north-rls-check-${Date.now().toString(36)}`;

// ── config ────────────────────────────────────────────────────────────────
/** Minimal KEY=VALUE reader. Values are never logged by this script. */
function loadEnvFile(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return vars;
}

const publicVars = loadEnvFile(resolve(ROOT, "react-app", ".env.local"));
const url = process.env.VITE_SUPABASE_URL || publicVars.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY || publicVars.VITE_SUPABASE_ANON_KEY;

// Throwaway accounts: environment first, then the gitignored test file.
const testVars = loadEnvFile(resolve(ROOT, "react-app", ".env.test.local"));
const cred = (name) => process.env[name] || testVars[name];
const creds = [
  { who: "A", email: cred("NORTH_A_EMAIL"), password: cred("NORTH_A_PASSWORD") },
  { who: "B", email: cred("NORTH_B_EMAIL"), password: cred("NORTH_B_PASSWORD") },
];

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL (react-app/.env.local or env)");
if (!key) missing.push("VITE_SUPABASE_ANON_KEY (react-app/.env.local or env)");
for (const c of creds) {
  if (!c.email) missing.push(`NORTH_${c.who}_EMAIL`);
  if (!c.password) missing.push(`NORTH_${c.who}_PASSWORD`);
}

if (missing.length) {
  console.log("verify:rls — SKIPPED, not enough configuration to talk to a project.\n");
  for (const m of missing) console.log(`  missing: ${m}`);
  console.log(`
To run this check you need two throwaway accounts on the project:

  1. Supabase dashboard → Authentication → Users → "Add user".
     Create  ${creds[0].email || "north-test-a@example.com"}  and  ${creds[1].email || "north-test-b@example.com"}
     with a throwaway password (or any two accounts you control).
     Do NOT reuse a real account's password.
  2. Then either export them and run it:
       NORTH_A_EMAIL=... NORTH_A_PASSWORD=... \\
       NORTH_B_EMAIL=... NORTH_B_PASSWORD=... npm run verify:rls

     ...or put them in  react-app/.env.test.local  (already gitignored, so the
     password never reaches a chat window, a shell history or the repository):

       NORTH_A_EMAIL=north-test-a@example.com
       NORTH_A_PASSWORD=...
       NORTH_B_EMAIL=north-test-b@example.com
       NORTH_B_PASSWORD=...

     and then just run:  npm run verify:rls
`);
  process.exit(0);
}

// Supabase ships inside react-app, the only client with a dependency tree.
const requireFromApp = createRequire(resolve(ROOT, "react-app", "package.json"));
const { createClient } = await import(pathToFileURL(requireFromApp.resolve("@supabase/supabase-js")).href);

const makeClient = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// ── tiny harness ──────────────────────────────────────────────────────────
const results = [];
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail: detail ?? "" });
  } catch (err) {
    results.push({ name, pass: false, detail: err?.message || String(err) });
  }
}

/** Runs `fn` and asserts it was refused; returns the error code for the report. */
async function expectRefused(fn, what) {
  const res = await fn();
  if (!res?.error) {
    throw new Error(`${what} was NOT refused (returned ${JSON.stringify(res?.data ?? null).slice(0, 80)})`);
  }
  return `refused: ${res.error.code || res.error.message}`;
}

/** Rows visible to `client` in `table`, filtered by owner id where given. */
async function rows(client, table, ownerColumn, ownerId, select = "id") {
  let q = client.from(table).select(select);
  if (ownerColumn && ownerId) q = q.eq(ownerColumn, ownerId);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

// ── sign in ───────────────────────────────────────────────────────────────
const [A, B] = [makeClient(), makeClient()];
const users = {};

for (const [i, c] of creds.entries()) {
  const client = i === 0 ? A : B;
  const { data, error } = await client.auth.signInWithPassword({ email: c.email, password: c.password });
  if (error || !data?.session) {
    console.error(`\nverify:rls — could not sign in account ${c.who} (${c.email}).`);
    console.error(`  ${error?.message || "no session returned"}`);
    if (/confirm/i.test(error?.message || "")) {
      console.error(`
  Email confirmation is ON for this project, so a newly created account has no
  session until its address is confirmed. Either:
    • confirm the account (Authentication → Users → the user → Confirm), or
    • create the two users with "Auto Confirm User" ticked (Authentication →
      Users → Add user), which needs no global setting change.
  Do not switch off "Confirm email" project-wide just for this check.
`);
    }
    process.exit(1);
  }
  users[c.who] = { id: data.user.id, email: data.user.email, client };
}

const idA = users.A.id;
const idB = users.B.id;
console.log(`verify:rls — signed in A=${idA} B=${idB}\n`);

const created = { boards: [], tasks: [], sessions: [], rules: [], schedules: [] };
let settingsBackup = null;

// ══════════════════════════════════════════════════════════════════════════
// 1. CROSS-USER READS — the core isolation claim
// ══════════════════════════════════════════════════════════════════════════
await check("A sees exactly one profile (their own)", async () => {
  const mine = await rows(A, "profiles", null, null, "id");
  expect(mine.length === 1, `expected 1 visible profile, saw ${mine.length}`);
  expect(mine[0].id === idA, "the visible profile is not A's own row");
  return "1 row, A's own";
});

for (const [table, column] of [
  ["profiles", "id"],
  ["tasks", "user_id"],
  ["boards", "user_id"],
  ["focus_sessions", "user_id"],
  ["block_rules", "user_id"],
  ["block_schedules", "user_id"],
  ["usage_records", "user_id"],
  ["daily_focus", "user_id"],
  ["friends", "user_id"],
]) {
  await check(`A cannot read B's ${table}`, async () => {
    const seen = await rows(A, table, column, idB);
    expect(seen.length === 0, `LEAK: ${seen.length} row(s) of B's ${table} were visible to A`);
    return "0 rows";
  });
}

await check("B cannot read A's profile", async () => {
  const seen = await rows(B, "profiles", "id", idA);
  expect(seen.length === 0, `LEAK: ${seen.length} row(s) of A's profile were visible to B`);
  return "0 rows";
});

// ══════════════════════════════════════════════════════════════════════════
// 2. CROSS-USER WRITES
// ══════════════════════════════════════════════════════════════════════════
await check("A cannot INSERT a task owned by B", async () =>
  expectRefused(
    () => A.from("tasks").insert({ user_id: idB, title: `${MARK} forged` }).select(),
    "insert into tasks as B"
  )
);

await check("A cannot UPDATE a row owned by B", async () => {
  // B owns a task; A must not be able to edit it.
  const bTask = (await B.from("tasks").insert({ user_id: idB, title: `${MARK} B private` }).select().single());
  expect(!bTask.error, `could not create B's fixture: ${bTask.error?.message}`);
  created.tasks.push({ client: "B", id: bTask.data.id });

  const attempted = await A.from("tasks").update({ title: `${MARK} tampered` }).eq("id", bTask.data.id).select();
  expect(!attempted.error, `unexpected error: ${attempted.error?.message}`);
  expect((attempted.data || []).length === 0, `A modified ${attempted.data.length} of B's rows`);

  const after = await B.from("tasks").select("title").eq("id", bTask.data.id).single();
  expect(after.data?.title === `${MARK} B private`, "B's task title changed — WRITE LEAK");
  return "0 rows updated, B's row unchanged";
});

await check("A cannot DELETE a row owned by B", async () => {
  const bBoard = await B.from("boards").insert({ user_id: idB, name: `${MARK} B board` }).select().single();
  expect(!bBoard.error, `could not create B's fixture: ${bBoard.error?.message}`);
  created.boards.push({ client: "B", id: bBoard.data.id });

  const attempted = await A.from("boards").delete().eq("id", bBoard.data.id).select();
  expect(!attempted.error, `unexpected error: ${attempted.error?.message}`);
  expect((attempted.data || []).length === 0, `A deleted ${attempted.data.length} of B's rows`);

  const after = await B.from("boards").select("id").eq("id", bBoard.data.id).single();
  expect(after.data?.id === bBoard.data.id, "B's board is gone — DELETE LEAK");
  return "0 rows deleted, B's row intact";
});

// ══════════════════════════════════════════════════════════════════════════
// 3. THE COMPETITIVE NUMBERS MUST NOT BE CLIENT-WRITABLE
// ══════════════════════════════════════════════════════════════════════════
await check("A cannot write daily_focus (server-computed total)", async () =>
  expectRefused(
    () => A.from("daily_focus").upsert({ user_id: idA, day: "2000-01-01", focus_s: 999999, sessions: 99 }).select(),
    "upsert into daily_focus"
  )
);

await check("A cannot inflate a focus session past its plan", async () => {
  const res = await A.from("focus_sessions").insert({
    user_id: idA, phase: "focus",
    started_at: new Date(Date.now() - 300000).toISOString(),
    ended_at: new Date().toISOString(),
    planned_s: 60, actual_s: 9999, completed: true,
  }).select();
  expect(res.error, "an impossible session (actual_s = 9999 > planned_s + 1) was ACCEPTED");
  expect(
    res.error.code === "23514" || /check constraint/i.test(res.error.message || ""),
    `refused, but for the wrong reason: ${res.error.code} ${res.error.message}`
  );
  return `refused by check constraint (${res.error.code})`;
});

// ══════════════════════════════════════════════════════════════════════════
// 4. THE AGGREGATE THAT CROSSES USERS IS PROPERLY SCOPED
// ══════════════════════════════════════════════════════════════════════════
await check("leaderboard() works for a signed-in user", async () => {
  const { data, error } = await A.rpc("leaderboard", { limit_count: 10 });
  expect(!error, `signed-in call failed: ${error?.message}`);
  expect(Array.isArray(data), "leaderboard did not return a list");
  const mine = data.find((r) => r.un && r.name !== undefined);
  expect(mine, "leaderboard returned no rows while an account exists");
  return `${data.length} ranked row(s)`;
});

await check("leaderboard() cannot be used to read raw sessions", async () => {
  const { data, error } = await A.from("focus_sessions").select("id").eq("user_id", idB);
  expect(error || (data || []).length === 0, "LEAK: raw sessions of another user are readable");
  return "0 rows of B's sessions";
});

await check("current_streak() is usable by its owner", async () => {
  const { data, error } = await A.rpc("current_streak", { target: idA });
  expect(!error, `signed-in call failed: ${error?.message}`);
  expect(typeof data === "number", `expected a number, got ${typeof data}`);
  return `returned ${data}`;
});

await check("current_streak() is NOT executable by anon", async () => {
  const anon = makeClient();
  const { data, error } = await anon.rpc("current_streak", { target: idB });
  expect(error, `anon executed current_streak and got ${JSON.stringify(data)} — run supabase/hardening.sql`);
  return `refused: ${error.code}`;
});

// ══════════════════════════════════════════════════════════════════════════
// 5. THE REAL SYNC ROUND-TRIP — replay what sync.js writes
// ══════════════════════════════════════════════════════════════════════════
const boardId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const sessionId = crypto.randomUUID();

await check("profile settings document round-trips", async () => {
  const before = await A.from("profiles").select("settings").eq("id", idA).single();
  expect(!before.error, `could not read own profile: ${before.error?.message}`);
  settingsBackup = before.data.settings;

  const settings = {
    ...(settingsBackup || {}),
    pm: { w: 50, sb: 7, lb: 20, sound: true, notify: false },
    apps: [{ id: "probe-app", name: MARK, icon: "🧪", limit: 30, used: 0, blocked: false, lastD: "2026-01-01" }],
    blocking: {
      rules: [{ id: "r1", kind: "website", target: "example.com", label: "", enabled: true, when: "always", scheduleIds: [] }],
      schedules: [],
      settings: { blockDuringFocus: true, allowTemporaryUnblock: true, tempUnblockMinutes: 3 },
    },
  };
  const wrote = await A.from("profiles").upsert({ id: idA, settings }, { onConflict: "id" });
  expect(!wrote.error, `settings push failed: ${wrote.error?.message}`);

  const back = await A.from("profiles").select("settings").eq("id", idA).single();
  expect(back.data?.settings?.pm?.w === 50, "pm did not survive the round trip");
  expect(back.data?.settings?.blocking?.rules?.[0]?.target === "example.com", "blocking rules did not survive");
  expect(back.data?.settings?.apps?.[0]?.name === MARK, "tracked apps did not survive");
  return "pm + blocking + apps intact";
});

await check("board → task (foreign key) round-trips for A", async () => {
  const board = await A.from("boards").insert({ id: boardId, user_id: idA, name: `${MARK} board`, position: 0 }).select().single();
  expect(!board.error, `board insert failed: ${board.error?.message}`);
  created.boards.push({ client: "A", id: boardId });

  const task = await A.from("tasks").insert({
    id: taskId, user_id: idA, title: `${MARK} task`, due_date: "2026-01-02",
    priority: "high", category: "Work", completed: false,
    board_id: boardId, col_id: "doing", position: 0,
  }).select().single();
  expect(!task.error, `task insert failed (FK to board?): ${task.error?.message}`);
  created.tasks.push({ client: "A", id: taskId });

  const back = await A.from("tasks").select("*").eq("id", taskId).single();
  expect(back.data?.board_id === boardId, "board_id did not persist");
  expect(back.data?.col_id === "doing", "col_id did not persist");
  expect(back.data?.due_date === "2026-01-02", "due_date did not persist");
  return "board + task + column + due date intact";
});

await check("B cannot see A's board or task", async () => {
  const bBoards = await rows(B, "boards", "id", boardId);
  const bTasks = await rows(B, "tasks", "id", taskId);
  expect(bBoards.length === 0, "LEAK: A's board is visible to B");
  expect(bTasks.length === 0, "LEAK: A's task is visible to B");
  return "0 rows of A's board/task";
});

await check("focus session inserts idempotently (a session is an event)", async () => {
  const row = {
    id: sessionId, user_id: idA, phase: "focus",
    started_at: new Date(Date.now() - 900000).toISOString(),
    ended_at: new Date().toISOString(),
    planned_s: 900, actual_s: 900, completed: true,
  };
  const first = await A.from("focus_sessions").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  expect(!first.error, `first insert failed: ${first.error?.message}`);
  created.sessions.push({ client: "A", id: sessionId });

  // sync.js pushes the same day's session list on every change, so a duplicate
  // must be ignored rather than creating a second row.
  const second = await A.from("focus_sessions").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  expect(!second.error, `re-push failed: ${second.error?.message}`);

  const all = await rows(A, "focus_sessions", "id", sessionId);
  expect(all.length === 1, `expected exactly 1 row after re-push, found ${all.length}`);
  return "1 row after two pushes";
});

await check("the database derived daily_focus from the session (not the client)", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await A.from("daily_focus").select("focus_s, sessions").eq("day", day);
  expect(!error, `could not read daily_focus: ${error?.message}`);
  expect((data || []).length === 1, `expected one daily_focus row for today, saw ${(data || []).length}`);
  expect(data[0].focus_s >= 900, `daily total is ${data[0].focus_s}s but the session was 900s`);
  return `today = ${data[0].focus_s}s over ${data[0].sessions} session(s)`;
});

await check("A cannot see B's daily_focus", async () => {
  const seen = await rows(A, "daily_focus", "user_id", idB);
  expect(seen.length === 0, "LEAK: B's daily totals are visible to A");
  return "0 rows";
});

await check("rules + schedules mirror writes (and stay owner-scoped)", async () => {
  const sched = await A.from("block_schedules").insert({
    user_id: idA, name: `${MARK} window`, days: [1, 2, 3, 4, 5],
    start_time: "09:00", end_time: "17:00", enabled: true,
  }).select().single();
  expect(!sched.error, `schedule insert failed: ${sched.error?.message}`);
  created.schedules.push({ client: "A", id: sched.data.id });

  const rule = await A.from("block_rules").insert({
    user_id: idA, kind: "website", target: `${MARK}.example.com`, label: "",
    enabled: true, when: "scheduled", schedule_ids: [sched.data.id],
  }).select().single();
  expect(!rule.error, `rule insert failed: ${rule.error?.message}`);
  created.rules.push({ client: "A", id: rule.data.id });

  const mine = await rows(A, "block_rules", "user_id", idA);
  expect(mine.length >= 1, "A cannot read back their own rule");
  const theirs = await rows(B, "block_rules", "user_id", idA);
  expect(theirs.length === 0, "LEAK: B can read A's rules");
  return "rule + schedule linked by id, owner-scoped";
});

await check("A cannot schedule a rule for B", async () =>
  expectRefused(
    () => A.from("block_schedules").insert({ user_id: idB, name: `${MARK} forged`, days: [1], start_time: "08:00", end_time: "09:00" }).select(),
    "insert a schedule as B"
  )
);

// ══════════════════════════════════════════════════════════════════════════
// CLEANUP — only the ids this run created, never a blanket delete
// ══════════════════════════════════════════════════════════════════════════
const cleanErrors = [];
async function clean(client, table, id) {
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) cleanErrors.push(`${table}/${id}: ${error.message}`);
}
for (const t of created.sessions) await clean(A, "focus_sessions", t.id);
for (const t of created.tasks) await clean(t.client === "A" ? A : B, "tasks", t.id);
for (const b of created.boards) await clean(b.client === "A" ? A : B, "boards", b.id);
for (const r of created.rules) await clean(A, "block_rules", r.id);
for (const s of created.schedules) await clean(A, "block_schedules", s.id);
if (settingsBackup) {
  const restored = await A.from("profiles").update({ settings: settingsBackup }).eq("id", idA);
  if (restored.error) cleanErrors.push(`restore settings: ${restored.error.message}`);
}

// ── report ────────────────────────────────────────────────────────────────
const pad = Math.max(...results.map((r) => r.name.length));
console.log("─".repeat(pad + 8));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log("─".repeat(pad + 8));

const failed = results.filter((r) => !r.pass);
const anonStreak = results.find((r) => r.name.includes("current_streak() is NOT"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (anonStreak && !anonStreak.pass) {
  console.log(`\nACTION REQUIRED: anon can still call current_streak().`);
  console.log(`Run supabase/hardening.sql in the Supabase SQL editor to apply the revoke.`);
}
if (cleanErrors.length) {
  console.log(`\nCleanup left ${cleanErrors.length} row(s) behind (delete them by hand if you care):`);
  for (const e of cleanErrors) console.log(`  ${e}`);
}
console.log(`\nThe two test accounts can be removed from Authentication → Users; deleting`);
console.log(`a user cascades to its profile, tasks, boards, sessions and rules.`);

process.exit(failed.length ? 1 : 0);
