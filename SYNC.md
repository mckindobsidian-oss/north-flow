# SYNC.md — exactly what syncs, and what does not

A precise inventory, written from the code (`react-app/src/lib/sync.js`,
`sync-map.js`, `focusly.jsx`) rather than from the intent. If a row here says a
thing syncs, that is because a push path exists for it; if it says it does not,
there is no path.

**Scope warning, stated first:** this documents the **web client only**. The
extension, desktop and mobile clients keep everything on the device (see the
last section). So "syncs" below means "syncs between web sessions on different
devices", which today is the whole of the working ecosystem.

## 0. The path a change takes

```
screen → S.* (storage boundary) → local cache ─────────────→ screens re-read it
                                 ↘ SYNC.afterWrite (if signed in)
                                    → sync-map.js     translate + fingerprint
                                    → sync.js         queue + push handlers
                                    → PostgREST       policy check (RLS)
                                    → Postgres tables

sign-in / boot → SYNC.bootstrap → push this device first, then pull the account
                                → local cache → screens
```

Four files matter, and only one of them knows about the network:

| File | Responsibility |
|---|---|
| `react-app/src/focusly.jsx` (`S`) | The single storage boundary. Every screen goes through it. Resolves `window.storage` → `localStorage` → in-memory. |
| `react-app/src/lib/sync-map.js` | Pure translation: app shape ⇄ table row, plus the change fingerprint. No network, no DOM — this is the half covered by `tests/sync.test.mjs`. |
| `react-app/src/lib/sync.js` | The engine: pending queue, push handlers, pull, leaderboard RPC. |
| `supabase/schema.sql` | Tables, constraints, triggers and RLS — the only place security is actually enforced. |

### What is written locally — every key the app uses

| Key | Holds | Also pushed? |
|---|---|---|
| `u:<user>` | the whole profile document: name, email, tasks, apps, friends, pomodoro, blocking rules/schedules/settings | **yes** |
| `bd:<user>` | kanban boards | **yes** |
| `fs:<user>:<date>` | raw focus-session records for that day | **yes** (insert-only) |
| `fo:<user>:<date>` | daily focus total in seconds | no — derived by the database trigger |
| `lb:<user>` (shared) | this account's leaderboard row (fm/tc/streak/last/name) | no — the server aggregate is authoritative |
| `lb:<other>` (shared) | other accounts' leaderboard rows, written by the pull | no |
| `sess` | `{ un }` — who this device is, so the app boots with no network | no |
| `fl_th` | theme choice (`"0"`/`"1"`) | no — **Step 4's job** |
| `fl_ctx` | right-click menu preference | no |
| `north:syncq` | the pending-push queue | n/a — this *is* the queue |

## 1. Data that syncs to the account

| App data | Trigger key | Postgres destination | Direction |
|---|---|---|---|
| Display name, email | `u:<user>` | `profiles.name`, `.email`, `.un` | push + pull |
| Pomodoro durations (`pm.w/sb/lb`) + sound/notify flags | `u:<user>` | `profiles.settings.pm` | push + pull |
| Blocking settings (block during focus, allow temp unblock, minutes) | `u:<user>` | `profiles.settings.{blockDuringFocus,allowTemporaryUnblock,tempUnblockMinutes}` | push + pull |
| Block rules (`rules[]`) and schedule windows (`schedules[]`) | `u:<user>` | `profiles.settings.blocking` (jsonb, authoritative) **and** mirrored into `block_rules` + `block_schedules` | push + pull (jsonb); push-only (mirror) |
| Tracked apps (name, icon, daily limit) | `u:<user>` | `profiles.settings.apps` | push + pull |
| Friends (usernames) | `u:<user>` | `friends` table | push + pull |
| Tasks (title, due, priority, category, completed, board, column, position) | `u:<user>` | `tasks` table | push + pull |
| Kanban boards (name, order) | `bd:<user>` | `boards` table | push + pull |
| Focus sessions (start, end, planned, actual, completed) | `fs:<user>:<date>` | `focus_sessions` (insert-only) | push (insert) + pull (today) |
| Daily focus totals | — | `daily_focus` | **pull only** |
| Leaderboard | `lb:` (shared) | `leaderboard()` RPC | **pull only** |

## 2. Data that deliberately does NOT sync

Each of these is a decision, not an oversight.

| Data | Where it lives | Why |
|---|---|---|
| Running focus window (`blocking.focus`) | device (`u:` record locally) | It is a countdown. Syncing it would let one device start a session that pauses another device's enforcement for a reason that no longer exists on that device. Each client evaluates its own. |
| Temporary unblocks (`blocking.unblocks`) | device | It is an expiry. Same reasoning — a 5-minute pause granted on a phone must not silently unblock a laptop an hour later. |
| Theme (`fl_th`) | `localStorage`, device | Currently device-local. **This is a known gap against the plan** — "user preferences should follow the account" — and is Step 4's job. |
| Right-click menu preference (`fl_ctx`) | `localStorage`, device | A genuine per-device preference (whether to intercept the browser menu). |
| Signed-in pointer (`sess`) | `localStorage`, device | Superseded by the Supabase session; it exists so the app boots offline. |
| Daily totals (`fo:`) | local cache | Never pushed. The database computes them from `focus_sessions` via a trigger, precisely so a client cannot forge its own score. Client writes to `fo:` are local-only and get corrected by the next pull. |

## 3. Fields that exist but are written by nobody

Dead weight found while tracing the push paths. Listed so they are not mistaken
for working features.

| Thing | Status |
|---|---|
| `usage_records` table | **Nothing writes it.** The extension tracks per-domain time in `chrome.storage.local`, but has no account, so it never posts. The web screen-time screen is manual entry stored in `profiles.settings.apps`. |
| `focus_sessions.phase` = `shortBreak` / `longBreak` | The timer only records phase 0. `finish()` persists a record only `if (p === 0)`, so break sessions are never stored — only focus sessions are. |
| `block_rules` / `block_schedules` mirror rows | Written on every profile push, **never read back**. Pulls reconstruct the blocking document from `profiles.settings.blocking`. The mirror exists for server-side reporting and joins. |
| `boards.cols` | Not stored. All three columns (todo/doing/done) are fixed by the product and rebuilt client-side. |
| `friends.status` / `friends.privacy` | Written with defaults (`accepted`, `board`), never read. There is no request/accept flow yet. |
| `current_streak()` | Never called by any client. The streak shown in the UI is computed locally. |
| `profiles.updated_at`, `tasks.updated_at` | Maintained by a trigger, unused by any client. |
| `tasks.position` | Written from array index; only used to order the pull. No manual reordering UI exists. |

## 4. Values computed per device (and therefore able to disagree)

`lb:<user>` holds three different kinds of number, and only one is server-owned:

| Field | Source | Consistent across devices? |
|---|---|---|
| `fm` (focus minutes) | Local increment on each session, then **overwritten** by the server aggregate on the next leaderboard fetch | Eventually yes |
| `tc` (completed task count) | Counted locally from the device's task list | No — converges only after a pull |
| `streak` | Computed locally in `addFocus` from `lb.last` | No |

`sync.js` merges rather than overwrites these on a leaderboard refresh, so the
server cannot erase a locally-tracked streak. The trade-off is accepted and
deliberate: the aggregate is authoritative for *public* numbers, the device is
authoritative for *private* ones.

## 5. Offline queue and conflict behaviour

### The offline queue

The queue stores **key names, not values** (`localStorage["north:syncq"]` is a
deduplicated list of strings). That is the design's main trick: the value is
already in the local cache, so the queue can never hold a stale copy of the
data — it only remembers *what* still needs sending.

Sequence for one edit:

1. The screen calls `S.set(key, value)`. The local cache is written first, so
   the UI never waits on a network round trip and works with no connection.
2. `SYNC.afterWrite(key)` adds the key to the queue — unless the app is signed
   out, no project is configured, or a pull is in progress (a pull must never
   echo back as a write).
3. A 900 ms debounce then runs `flush()`, which walks the queue and calls the
   matching push handler for each key.
4. Any key whose push fails is written back into the queue for the next attempt.
   Failures are logged with a `[north sync]` prefix and never thrown at the UI.

**Retry is not a background timer.** A pending change is retried on the next
flush: any subsequent edit, or the next time the app starts and signs in. Close
the tab on a plane and the work is still queued on the disk when you come back.
When the account changes, the queue is cleared — those keys belong to the
previous account and must not leak into the new one.

### Conflict behaviour

Whole-record, **last write wins**, per storage key. Stated plainly, with its
limits:

| Data | Conflict rule |
|---|---|
| Tasks, boards | Synced by id, then a prune deletes server rows whose ids are no longer present. The last device to push wins **wholesale** — there is no per-field merge. |
| Profile document | Pushed as one document; same rule. |
| Focus sessions | **No conflicts possible.** Insert-only and idempotent by uuid: a session is an event, never rewritten. |
| `daily_focus` | **No conflicts possible.** Derived server-side from the sessions, so it is a function of data that cannot disagree. |
| Leaderboard | Server aggregate wins for public numbers; the device wins for its own streak/task count (explicitly merged in `leaderboard()`). |

The honest limitation: two devices editing the same task while both are offline
will see one overwrite the other, whichever flushes second. There are no vector
clocks and no per-field reconciliation. For one person on several devices that
is a reasonable trade; it would not be for collaborative editing.

## 6. Clients that do not sync at all

| Client | Where its data actually lives | What it would need |
|---|---|---|
| Browser extension | `chrome.storage.local` (`northBlocking`, `usage`); the "account" is a username string | Real sign-in (`chrome.identity` + web redirect), then push/pull through the same tables |
| Desktop app | `north-blocking.json` in the OS app-config dir | Sign-in, and a build that has ever been compiled |
| Mobile app | React state only — **lost on every restart** | `AsyncStorage` first, then sign-in |

## 7. How to verify any of this yourself

### Automatically, from two accounts

```bash
NORTH_A_EMAIL=... NORTH_A_PASSWORD=... \
NORTH_B_EMAIL=... NORTH_B_PASSWORD=... npm run verify:rls
```

`scripts/verify-rls.mjs` signs in as two real accounts and attacks them through
the same client the app ships and the same PostgREST endpoint the browser calls.
It asserts every isolation claim in this document, plus the full sync
round-trip, and prints PASS/FAIL per check. Credentials come from the
environment only — never from the repository. With none set it prints what is
missing and exits 0, so it is safe anywhere.

It is intentionally **not** part of `npm test`: routine test runs must never
write to a live database. It creates a small set of marker-tagged rows and
deletes exactly those ids afterwards.

### By hand

The two behaviours worth confirming by hand, once you have two accounts:

1. **Push works:** add a task in the web app, then open Supabase → Table editor →
   `tasks`. A row should appear within ~1 second (the push is debounced 900 ms).
2. **Pull works:** sign in on a second browser (or a private window) and the task
   is there. Then watch `daily_focus` after finishing a focus session: the total
   is written by the database trigger, not by the client.

If either step fails, the failure is visible in the browser console — every sync
problem is logged with a `[north sync]` prefix.
