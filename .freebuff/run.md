# NORTH — preview run doc

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

4. `react-app/.env.local` — holds the two **public** Supabase values
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). A fresh checkout ships them
   as placeholders (`YOUR_SUPABASE_URL`); that is fine and the preview runs
   normally, because `src/lib/supabase.js` only builds a client when the values
   look real and otherwise reports "not configured" in the login screen instead
   of throwing. Real values (from `SETUP.md`) are needed only for real
   sign-in/sign-up. Never commit a real `service_role` key — see `SETUP.md`.

Dependencies: `npm install` inside `react-app/` (React, lucide-react, Vite,
oxlint, `@supabase/supabase-js`).

## Backend

`react-app/src/lib/sync.js` mirrors the app's `S.*` writes into the Supabase
tables and pulls them back; `react-app/src/lib/sync-map.js` holds the pure
app-shape ⇄ table-row mappers, so they are covered by `tests/sync.test.mjs`
without a database or a browser. The preview harness has no Supabase session,
so sync stays detached there and the demo account remains local — which is
exactly the offline path a real device falls back to.

## Shared modules (do this once, and after editing `packages/`)

`react-app/src/shared/`, `apps/extension/lib/` and `apps/mobile/shared/` hold
GENERATED copies of `packages/shared-types/blocking.js` and `account.js` — the
blocking engine and account mapper every client runs. Regenerate with:

```bash
npm run sync:shared      # from the repo root
npm run check:shared     # fails if a copy has drifted (npm test runs this too)
```

The extension needs its copy inside its own package and Vite/Metro each need
one inside their own roots, which is why they are vendored rather than imported
(see `scripts/sync-shared.mjs` for the whole rationale).

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
in-memory store resets on reload. Default theme is **light**, with a visible
sun/switch/moon control in the header (choice persists on the device).

Two entries exist, and the difference matters:

| Entry | Serves |
|---|---|
| `preview.html` → `src/preview.jsx` | the demo harness: installs the `window.storage` shim and seeds the "demo"/Aarav account (tasks, boards, ~75 days of focus history) |
| `index.html` → `src/entry.jsx` | the real app: no seeding, no shim (`S.*` falls back to localStorage). This is what `npm run build` compiles, so the build verifies the actual product. |

Verification commands (root): `npm test` (blocking engine + account mapper),
`npm run lint`, `npm run build`. Design
rules follow the installed `apple-design` skill (`.agents/skills/apple-
design/SKILL.md`): fluid press feedback, scroll-edge frosted header (`.mtrl`),
page arrival via `.pge`, and `prefers-reduced-motion` / `prefers-reduced-
transparency` fallbacks in the injected `G()` stylesheet.
