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
| Browser extension | `apps/extension/` | **Functional** — real website blocking via `declarativeNetRequest`, NORTH block page, schedules, Focus Mode enforcement, account sync, usage |
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

npm test              # blocking engine, account mapper, extension decision layer, backend mapping
npm run check:jsx     # parse every client's JS/JSX (the only compiler 3 of 4 have)
npm run sync:shared   # re-vendor the shared modules after editing packages/
npm run verify:rls    # prove every table's row-level security against live Supabase
npm run verify:extension   # block a real website in a real browser (see the script header)
npm run audit:responsive   # 15-viewport × 7-screen layout audit in a headless Chromium
```

`audit:responsive` launches a throwaway headless Chromium (or attaches to a
running one with `-- --cdp=http://127.0.0.1:9222`), resizes through the whole
matrix the app is designed for — 320px SE through 2560px monitor, portrait and
landscape — walks every tab at each size, and fails on sideways page scroll,
content clipped past the page edge, or tap targets under 32px on touch-sized
screens. Start `npm run dev` first.

## Feature status

**Real today:** accurate Pomodoro (wall-clock, custom durations, chime +
notification, tab-title countdown, honest partial credit), tasks, calendar month
view, focus-session history + 26-week activity heatmap, screen-time tracker
(manual logging, labelled as such), **cross-device sync of tasks, focus
sessions, block rules, schedules, friends and settings**, supabase email sign-in
with a single account mapper plus a real password-reset journey, a
**server-computed leaderboard**, and **North Flow** (the configures-and-reports
half of blocking: website/application rules, schedule windows, temporary
unblocks, live “what is blocked right now and why”, and the browser extension's
connected status).

**Enforced by the client that can do it:** websites → the browser extension,
which stops the request in the browser and shows NORTH's own block page, and
enforces Focus Mode started here (the running window rides the account);
applications → the desktop app (it ends the matching process; user-space code
cannot prevent a launch, so a blocked app can still appear for a second).
**Needs the Google Cloud phase:** real Google Calendar sync. **Needs an OS
entitlement:** mobile app limits. **Still to wire:** Google sign-in on the
extension (email + password already works there) and mobile persistence, so
those two clients keep more of their state on the device than the web client —
the reference implementation — which is fully on the backend.

Exact setup steps: `SETUP.md`. Architecture & data model: `ARCHITECTURE.md`.
Going live (host config, env vars, Supabase URL configuration): `DEPLOY.md`.
