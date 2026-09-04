# Focusly — Architecture

## 1. Capability map (who may do what)

OS rules are not opinions: a website **cannot** block apps or track the whole
computer, so each capability lives in the client that can legally provide it.

| Capability | Web | Extension | Desktop (Tauri) | Mobile (Expo) |
|---|---|---|---|---|
| Timer, tasks, boards, calendar, heatmap | ✅ | popup quick-start | shell (later full) | ✅ (later full) |
| Configure block lists / limits | ✅ | ✅ | ✅ | ✅ |
| Block websites + track browsing | — | ✅ MV3 `declarativeNetRequest` + `tabs` | — | — |
| Track/block OS apps | — | — | ✅ native (Windows `EnumWindows`, macOS `NSWorkspace`) | ✅ iOS Screen Time / Android `UsageStatsManager` |
| Cross-device sync & real leaderboard | ✅ (needs Supabase) | ✅ | ✅ | ✅ |
| Google Calendar | ✅ (needs OAuth) | — | — | — |

Rule: **no client fakes another client's capability.** Unimplemented native
features return explicit "not implemented" errors, never pretend success.

## 2. Clients

- **Web** (`react-app/`) — the primary product today. React 19 + Vite, one
  well-organized component file with a token-based theme (`K`), system font
  stack, `lucide-react` icons. Data goes through `S.*` (single storage
  boundary): host `window.storage` → `localStorage` → in-memory. Supabase will
  be a fourth adapter behind the same `S.*` API.
- **Extension** (`apps/extension/`) — MV3. Blocking = dynamic
  `declarativeNetRequest` rules; focus deadlines = `alarms` (survives worker
  sleep); usage = per-domain seconds per day in `chrome.storage.local`.
- **Desktop** (`apps/desktop/`) — Tauri 2. Rust owns tray + native commands;
  UI is a static web shell in `dist/` (plain page → swap for the full web app
  when the backend exists). OS app tracking/blocking will be pure Rust.
- **Mobile** (`apps/mobile/`) — Expo. Mirrors the web tabs; device blocking
  uses each OS's screen-time APIs.

## 3. Data model

Today everything is JSON keys in one store (`u:<user>`, `fo:<user>:<date>`,
`fs:<user>:<date>`, `bd:<user>`, `lb:<user>`). The Supabase phase migrates to
Postgres. Canonical shapes live in `packages/shared-types/`:

`users` · `profiles` · `tasks` (board/col/pos, priority, category, due;
future: description, due-time, recurrence, estimated sessions) · `boards` ·
`focus_sessions` (raw per-session records — the single source for counts,
history, analytics, heatmaps) · `daily_focus` · `calendar_events` ·
`integrations` (encrypted OAuth tokens, server-side only) · `website_usage` ·
`app_usage` · `block_rules` · `friends` · `challenges` · `leaderboard` ·
`achievements` · `user_settings` · `privacy`.

Rules: every row owner-scoped with Postgres RLS; stable IDs (never display
names); timestamps stored consistently and rendered in the user's timezone;
competitive stats (leaderboard/XP) validated server-side so clients can't
inflate them; no permanent storage of page contents or history paths.

## 4. Sync strategy

Server (Postgres) is the source of truth. Clients cache locally for offline
use; focus sessions recorded offline are queued and reconciled on reconnect —
a completed session is never lost to a failed network request. Extension and
desktop post usage/block events to the same tables the web reads.

## 5. Key decisions

- **Supabase** over a hand-rolled backend: auth (email + Google), Postgres +
  RLS, Realtime, one free tier — no custom token code to get wrong.
- **Google sign-in ≠ Google Calendar access.** Calendar is a separate OAuth
  consent with its own minimal scopes; tokens stay server-side.
- **Apple design without Apple assets:** SF Pro can't be shipped to non-Apple
  platforms, so the UI uses each platform's own system font + Apple's *system
  color palette and materials* (grouped gray canvas, pure-black dark mode,
  frosted blur). `lucide-react` gives one consistent stroke-icon language.
- **No theme toggle:** the app follows `prefers-color-scheme` (or the OS
  setting on native clients), exactly like Apple's own apps.

## 6. Roadmap

1. ✅ Web product + Apple theme + Boards + scaffolding *(this round)*
2. Supabase: real accounts, migration, RLS, sync, real leaderboard — *needs your free Supabase project (SETUP.md)*
3. Google Calendar OAuth — *needs your free Google Cloud project (SETUP.md)*
4. Extension full: block-during-focus schedules, backend posting
5. Desktop: app usage tracking + blocking, global shortcuts
6. Mobile: full product + device blocking APIs
7. Gamification: XP/achievements/challenges (server-validated)
8. Analytics: full-year heatmap, productive hours, streaks
