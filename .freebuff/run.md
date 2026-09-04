# Focusly — preview run doc

The web app is `react-app/src/focusly.jsx` (React 19, token-based Apple
theme, `lucide-react` icons). It talks to a host-provided `window.storage`
API, which a plain browser does not have, so the preview runs it through an
in-memory shim with seeded demo data (logged in as "demo" / Aarav).

## Reproduce the preview artifacts

All files are committed to the worktree; if a fresh checkout lacks them,
recreate them:

1. `react-app/src/preview.jsx` — browser shim for `window.storage`
   (in-memory `Map`; `list()` must return keys WITHOUT the `s:` shared prefix,
   because the app does `k.slice(3)`) + demo seed: user "demo"/Aarav with
   tasks (several pinned to kanban boards), apps, friends, two kanban boards
   (`bd:demo`), leaderboard entries, ~75 days of deterministic focus history
   (`fo:` daily totals) and two completed `fs:` sessions today — so the heatmap
   and Boards aren't empty in the preview. Real accounts start empty.
   It imports `./focusly.jsx` and renders `<App />`.
2. `react-app/vite.preview.config.js` — Vite config, port `5174`,
   `strictPort: true` (kept clear of the default 5173). No `fs.allow` needed:
   focusly.jsx lives inside the project root.
3. `react-app/preview.html` — HTML shell that loads `/src/preview.jsx`;
   sets an emoji favicon and allows both light and dark color schemes. No
   webfont: the app uses the platform's own UI font stack (SF Pro on Apple
   devices, Segoe UI Variable on Windows).

No env files are needed. Dependencies: `npm install` inside `react-app/`
(installs React, lucide-react, Vite, oxlint).

## Run the server

From `react-app/`:

```bash
npm run dev -- --config vite.preview.config.js
```

Or detached on Windows:

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--config','vite.preview.config.js' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
```

The app is served at `http://localhost:5174/preview.html` (pinned with
`strictPort: true`). Sign out inside the app to see the login screen; the
in-memory store resets on reload. The theme follows the OS — there is no
manual toggle.
