# NORTH — Architecture

## 1. Capability map (who may do what)

OS rules are not opinions: a website **cannot** block apps or track the whole
computer, so each capability lives in the client that can legally provide it.

| Capability | Web | Extension | Desktop (Tauri) | Mobile (Expo) |
|---|---|---|---|---|
| Timer, tasks, boards, calendar, heatmap | ✅ | popup quick-start | shell (needs the web app) | notes only (needs port) |
| Configure block rules / schedules | ✅ | ✅ | ✅ | ✅ |
| Block websites + track browsing | — | ✅ MV3 `declarativeNetRequest` + `tabs` | — | — |
| End blocked applications while a rule is active | — | — | ✅ `sysinfo` process list + kill | — |
| Prevent an app from launching at all | — | — | ⚠️ needs a driver / MDM profile — **not** claimed | ⚠️ needs Screen Time / UsageStats entitlement |
| Cross-device sync & real leaderboard | ✅ **live** (`lib/sync.js`) | linked account only | linked account only | — |
| Google Calendar | ✅ (needs OAuth) | — | — | — |

Rule: **no client fakes another client's capability.** Unimplemented native
features return explicit "not implemented" errors, never pretend success, and
the web app renders its own limits from this table (`CLIENT_CAPABILITIES` in
the shared engine) rather than describing them in prose that could drift.

### 1.1 The blocking engine (`packages/shared-types/blocking.js`)

Website rules, application rules, schedules, focus sessions and temporary
unblocks are **one model**, evaluated by one pure function:

```js
evaluateBlocking(state, now)
// → { active, websites[], apps[], reasons{ruleId → "always" | "focus" |
//      "schedule:<name>" | "temp-unblock"}, focus{…}, schedules[] }
```

Each client asks that question and enforces only its own half. Consequences
worth stating, because they are what make the four clients feel like one
product:

- **A focus session is one fact.** The web timer writes the session window into
  the shared state; the extension and desktop app read it. No client invents
  its own notion of “focus”.
- **Schedules are evaluated, not scheduled.** Rather than each client storing a
  timer per rule, the engine answers “what now?”, and consumers set a single
  wake-up for the next boundary (`msUntilBoundary`). One code path covers
  always-on, focus and scheduled rules, and a missed alarm self-heals on the
  next tick.
- **A temporary unblock needs no cleanup.** It is an expiry the engine honours;
  after it lapses the original rule applies again with no bookkeeping.
- **Legacy setups migrate.** `migrateLegacy` turns the extension's old flat
  `blockedSites` list and the web tracker's `blocked` flags into rules, so an
  upgrade never silently stops blocking something.

The pure shape is not an accident: it is what lets one Node test suite cover
the logic of all four clients (`tests/blocking.test.mjs`). The only
re-implementation is the schedule-window check in Rust (`is_schedule_active`),
because a Rust process cannot call into JS; it mirrors the JS semantics exactly,
including cross-midnight windows and the “zero-length window never blocks” rule.

### 1.2 Sharing code without a build system

The three JS clients each need their own copy of the shared modules (an MV3
extension may only load files inside its package; Metro needs extra watch
folders; Vite refuses files outside its root). Rather than three bespoke build
configurations, `scripts/sync-shared.mjs` vendors the canonical files into each
client with a GENERATED header, and `npm test` fails if a copy has drifted.

## 2. Clients

- **Web** (`react-app/`) — the primary product today, and the reference
  implementation. React 19 + Vite, one well-organized component file with a
  token-based theme (`K`), system font stack, `lucide-react` icons. Data goes
  through `S.*` (single storage boundary): host `window.storage` →
  `localStorage` → in-memory, with `lib/sync.js` mirroring the same writes into
  Supabase and pulling them back. No screen knows the backend exists.
- **Extension** (`apps/extension/`) — MV3. Blocking = dynamic
  `declarativeNetRequest` rules; focus deadlines = `alarms` (survives worker
  sleep); usage = per-domain seconds per day in `chrome.storage.local`.
- **Desktop** (`apps/desktop/`) — Tauri 2. Rust owns tray + native commands
  and the process enforcement; UI is currently a small static shell in `dist/`.
  The backend it was waiting for now exists (`lib/sync.js` talks to the same
  tables), so pointing its window at the built web app is the next step — the
  client already proves enforcement, it just does not yet show the full product
  UI around it.
- **Mobile** (`apps/mobile/`) — Expo. Mirrors the web tabs; device blocking
  uses each OS's screen-time APIs.

## 3. Data model

The app's storage keys (`u:<user>`, `fo:<user>:<date>`, `fs:<user>:<date>`,
`bd:<user>`, `lb:<user>`) are now a **local cache** in front of Postgres, not
the record of truth. `react-app/src/lib/sync.js` maps each key onto its table
(`u:` → `profiles` + `tasks` + `friends` + `block_rules`/`block_schedules`,
`bd:` → `boards`, `fs:` → `focus_sessions`); `fo:` is written only by the
database trigger and read back, and `lb:` comes from the `leaderboard()`
function. Canonical shapes live in `packages/shared-types/`:

`profiles` · `tasks` (board/col/pos, priority, category, due; future:
description, due-time, recurrence, estimated sessions) · `boards` ·
`focus_sessions` (raw per-session records — the single source for counts,
history, analytics, heatmaps) · `daily_focus` (roll-up, written only by a
security-definer trigger so totals cannot be forged) · `block_rules` ·
`block_schedules` · `usage_records` · `friends` · `leaderboard()` (aggregate
only, via a security-definer function) · `calendar_events` · `integrations`
(encrypted OAuth tokens, server-side only) · later: `challenges` ·
`achievements` · `privacy`.

**Written and waiting:** `supabase/schema.sql` (tables, constraints, trigger
that creates a profile on sign-up, RLS on every table) and
`supabase/rls-check.sql` (runs each isolation claim as an impersonated
`authenticated` role, including the two negative tests that must fail). Nothing
switches over yet: the local adapter stays authoritative until the sync path is
verified, per §4.

Rules: every row owner-scoped with Postgres RLS; stable IDs (never display
names); timestamps stored consistently and rendered in the user's timezone;
competitive stats (leaderboard/XP) validated server-side so clients can't
inflate them; no permanent storage of page contents or history paths.

## 4. Sync strategy

Server (Postgres) is the source of truth. Clients cache locally for offline
use; changes made without a connection are queued (persisted, so a reload does
not lose them) and retried until they land — a completed focus session is never
lost to a failed network request.

Implemented in `react-app/src/lib/sync.js`. Three rules make it safe:

- **Local first for reads.** Every screen renders from the cache, so the timer
  and the boards never wait on a round trip and work offline.
- **Idempotent writes.** Ids are UUIDs, so the same record pushed twice lands on
  the same row; focus sessions are insert-only (`ignoreDuplicates`) because a
  session is an event that is never rewritten.
- **Push before pull, once.** The first time a device links to an account its
  local record is pushed up and the server's rows are then pulled down, so a
  record made before signing in is never discarded. Afterwards the server wins;
  conflicts are whole-record, last-write-wins.

Two things are deliberately *not* synced: the running focus window and
Temporary unblocks. They are expiries and countdowns — syncing them would let
one device pause another's enforcement for a reason that no longer exists. Each
client evaluates its own copy from the rules, which ARE shared. The focus
sessions those windows produce are synced, because they are permanent.

Extension and desktop will post usage/block events to the same tables the web
reads; that arrives with their sign-in work (below).

## 5. Key decisions

- **Supabase** over a hand-rolled backend: auth (email + Google), Postgres +
  RLS, Realtime, one free tier — no custom token code to get wrong.
- **Google sign-in ≠ Google Calendar access.** Calendar is a separate OAuth
  consent with its own minimal scopes; tokens stay server-side.
- **Apple design without Apple assets:** SF Pro can't be shipped to non-Apple
  platforms, so the UI uses each platform's own system font + Apple's *system
  color palette and materials* (grouped gray canvas, pure-black dark mode,
  frosted blur). `lucide-react` gives one consistent stroke-icon language.
- **Theme:** follows `prefers-color-scheme` by default (or the OS setting on
  native clients), with one deliberate deviation from stock Apple apps — a
  manual light/dark switch in the header, because it was asked for. The choice
  is device-local (`fl_th`), never account data, and every colour comes from the
  `K` token palette so the two themes cannot drift.

## 6. Roadmap

1. ✅ Web product + Apple theme + Boards + client scaffolding
2. ✅ Shared blocking engine, account mapper, web blocking center, real
   extension blocking (schedules, focus, temporary unblocks), desktop process
   enforcement, mobile foundation, Supabase schema + RLS
3. ✅ Supabase live: `S.*` mirrors onto `supabase/schema.sql`, persisted offline
   queue + push-then-pull reconciliation, real server-computed leaderboard
4. ✅ Production: static host config (`vercel.json`, `netlify.toml`), real
   password-reset journey, deploy guide (`DEPLOY.md`)
5. Google Calendar OAuth — *needs your free Google Cloud project (SETUP.md)*
6. Extension: real sign-in via `chrome.identity`, posting usage to the account
7. Desktop: window pointed at the built web app, verified `cargo check`/build,
   global shortcuts, macOS/Windows launch-prevention research (driver / MDM)
8. Mobile: `AsyncStorage` persistence, sign-in, notifications, ported boards
9. Gamification: XP/achievements/challenges (server-validated)
10. Analytics: full-year heatmap, productive hours, streaks
