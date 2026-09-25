# NORTH 🧭

A productivity ecosystem — timer, tasks + kanban boards, calendar, app/website
tracker, and a social leaderboard — designed to make a person *want* to focus.
One product, several clients, all sharing one account and data model:

```
               NORTH
                 │
           Shared Backend (Supabase — live)
            auth · Postgres · row-level security
                 │
     ┌──────┬────┴────┬──────┐
    WEB   EXTENSION  DESKTOP  MOBILE
```

Design language: **Apple** — iOS grouped surfaces, system blue, frosted
translucent chrome, and the platform's own UI font (SF Pro on Apple devices,
Segoe UI on Windows). Theme follows the device automatically; there is no
manual dark/light toggle.

## Clients

| Client | Folder | Status |
|---|---|---|
| Web app | `react-app/` (`src/focusly.jsx`) | **Functional** — full product + blocking center |
| Browser extension | `apps/extension/` | **Functional** — real website blocking, schedules, focus, usage |
| Desktop (Tauri) | `apps/desktop/` | **Functional** (unverified build) — enforces application rules against real processes |
| Mobile (Expo) | `apps/mobile/` | Foundation — blocking configuration; enforcement is OS-gated |
| Shared model | `packages/shared-types/` | Domain contracts **and the blocking engine every client runs** |
| Shared backend | `react-app/src/lib/sync.js` + `supabase/` | **Live** — every client writes to one Postgres database through one data layer |

## One blocking model, four clients

Rules, schedules, focus sessions and temporary unblocks are defined once in
`packages/shared-types/blocking.js`, and each client enforces only the half its
platform legally allows:

| | Configure rules | Enforce websites | Enforce applications |
|---|---|---|---|
| Web app | ✅ | — (a page cannot block a browser) | — |
| Browser extension | ✅ | ✅ `declarativeNetRequest` | — |
| Desktop app | ✅ | — | ✅ ends the process (`sysinfo`) |
| Mobile app | ✅ | — | — (needs an OS entitlement we do not ship) |

The web app shows this table on the Blocking screen, so “configured” never
masquerades as “enforced”. `npm test` covers the engine's logic once for all
four clients; `npm run sync:shared` vendors it into each client (the extension,
Metro and Vite each need their own copy — see `scripts/sync-shared.mjs`).

> The web app is a single React file (`focusly.jsx`) styled with an inline
> token system (`K`) — light + dark Apple palettes. `react-app/src/preview.jsx`
> is a browser-only harness that shims the host storage API so the app runs
> anywhere (`window.storage` → `localStorage` → in-memory fallback).
>
> **The backend is wired.** `react-app/src/lib/sync.js` mirrors every write the
> `S.*` boundary makes into the Supabase tables and pulls them back on the next
> device, with a persisted offline queue (`localStorage["north:syncq"]`). Reads
> stay local-first, so the timer and the boards never wait on the network and
> keep working offline. The pure half of the translation lives in
> `lib/sync-map.js` and is unit-tested in `tests/sync.test.mjs`.

## Quickstart (web)

```bash
npm --prefix react-app install     # first time
npm run dev                        # root script → preview config, port 5174
#   http://localhost:5173   the real app (src/entry.jsx)
#   http://localhost:5174/preview.html   demo account (see .freebuff/run.md)

npm test              # blocking engine, account mapper, backend mapping (40 tests, no browser)
npm run check:jsx     # parse every client's JS/JSX (the only compiler 3 of 4 have)
npm run sync:shared   # re-vendor the shared modules after editing packages/
```

## Feature status

**Real today:** accurate Pomodoro (wall-clock, custom durations, chime +
notification, tab-title countdown, honest partial credit), tasks, kanban
Boards, calendar month view, focus-session history + 16-week activity heatmap,
screen-time tracker (manual logging, labelled as such), **cross-device sync of
tasks, boards, focus sessions, block rules, schedules, friends and settings**,
supabase email sign-in with a single account mapper plus a real
password-reset journey, a **server-computed leaderboard**, and the blocking
center (website/application rules, schedule windows, temporary unblocks, live
“what is blocked right now and why”).

**Enforced by the client that can do it:** websites → the extension;
applications → the desktop app (it ends the matching process; user-space code
cannot prevent a launch, so a blocked app can still appear for a second).
**Needs the Google Cloud phase:** real Google Calendar sync. **Needs an OS
entitlement:** mobile app limits. **Still to wire:** extension and mobile
sign-in (the extension links an account name; mobile has no persistence yet),
so those two clients keep their rules on the device while the web client — the
reference implementation — is fully on the backend.

Exact setup steps: `SETUP.md`. Architecture & data model: `ARCHITECTURE.md`.
Going live (host config, env vars, Supabase URL configuration): `DEPLOY.md`.
