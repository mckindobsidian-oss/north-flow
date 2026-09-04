# Focusly ⚡

A productivity ecosystem — timer, tasks + kanban boards, calendar, app/website
tracker, and a social leaderboard — designed to make a person *want* to focus.
One product, several clients, all sharing one account and data model:

```
              FOCUSLY
                 │
          Shared Backend (Supabase — next phase)
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
| Web app | `react-app/` (`src/focusly.jsx`) | **Functional** — full product |
| Browser extension | `apps/extension/` | Scaffold — real blocking + usage + focus |
| Desktop (Tauri) | `apps/desktop/` | Scaffold — window + tray + focus commands |
| Mobile (Expo) | `apps/mobile/` | Scaffold — tab shell, honest placeholders |
| Shared types | `packages/shared-types/` | Domain contracts for all clients |

> The web app is a single React file (`focusly.jsx`) styled with an inline
> token system (`K`) — light + dark Apple palettes. `react-app/src/preview.jsx`
> is a browser-only harness that shims the host storage API so the app runs
> anywhere (`window.storage` → `localStorage` → in-memory fallback). That
> `S.*` layer is the swap point for the real backend.

## Quickstart (web)

```bash
npm --prefix react-app install     # first time
npm --prefix react-app run dev -- --config react-app/vite.preview.config.js
# open http://localhost:5174/preview.html  (see .freebuff/run.md for the full recipe)
```

## Feature status

**Real today:** accurate Pomodoro (wall-clock, custom durations, chime +
notification, tab-title countdown, honest partial credit), tasks, kanban
Boards, calendar month view, focus-session history + 16-week activity heatmap,
app-limit tracker (manual logging), in-store leaderboard/friends, theme
auto-following, full keyboard accessibility.

**Mapped to the right client (not faked):** website blocking + usage tracking
→ the extension; app blocking + usage → desktop & mobile. **Needs the Supabase
phase:** real accounts, cross-device sync, honest multi-device leaderboard.
**Needs the Google Cloud phase:** real Google Calendar sync. Exact setup steps:
`SETUP.md`. Architecture & data model: `ARCHITECTURE.md`.
