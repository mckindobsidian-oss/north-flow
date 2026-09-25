# SYNC.md — exactly what syncs, and what does not

A precise inventory, written from the code (`react-app/src/lib/sync.js`,
`sync-map.js`, `focusly.jsx`) rather than from the intent. If a row here says a
thing syncs, that is because a push path exists for it; if it says it does not,
there is no path.

**Scope warning, stated first:** this documents the **web client only**. The
extension, desktop and mobile clients keep everything on the device (see the
last section). So "syncs" below means "syncs between web sessions on different
devices", which today is the whole of the working ecosystem.

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

## 5. Clients that do not sync at all

| Client | Where its data actually lives | What it would need |
|---|---|---|
| Browser extension | `chrome.storage.local` (`northBlocking`, `usage`); the "account" is a username string | Real sign-in (`chrome.identity` + web redirect), then push/pull through the same tables |
| Desktop app | `north-blocking.json` in the OS app-config dir | Sign-in, and a build that has ever been compiled |
| Mobile app | React state only — **lost on every restart** | `AsyncStorage` first, then sign-in |

## 6. How to verify any of this yourself

The two behaviours worth confirming by hand, once you have two accounts:

1. **Push works:** add a task in the web app, then open Supabase → Table editor →
   `tasks`. A row should appear within ~1 second (the push is debounced 900 ms).
2. **Pull works:** sign in on a second browser (or a private window) and the task
   is there. Then watch `daily_focus` after finishing a focus session: the total
   is written by the database trigger, not by the client.

If either step fails, the failure is visible in the browser console — every sync
problem is logged with a `[north sync]` prefix.
