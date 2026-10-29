# NORTH — Desktop App (Tauri 2)

Why Tauri over Electron: a fraction of the disk/RAM footprint, and the Rust
core is where OS-level integration (process inspection, app blocking, tray,
global shortcuts) naturally lives. If Rust ever becomes the bottleneck, the
frontend is a plain web page and can move to Electron unchanged.

## Run it

Prerequisites on Windows: **Node.js**, **Rust stable (MSVC)**, Microsoft C++ Build Tools and the Windows SDK. Then, from the project root:

```bash
npm install --prefix apps/desktop
npm run desktop:dev
# Testable debug executable, without an installer:
npm run desktop:build -- --debug --no-bundle
# Installer/release bundle:
npm run desktop:build
```

The app bundles the full React interface from `react-app/dist`; it runs locally with the same account, tasks, Focus, Calendar, Flow and sound preferences as the website. A native bridge supplies foreground app usage and applies account limits to the Rust enforcer. Website blocking remains the browser extension's job.

The debug executable is `apps/desktop/src-tauri/target/debug/north-desktop.exe`. Closing its window hides it to the tray; use **Quit** in the tray menu to stop the app. Windows `cargo check`, a debug build, and a native smoke launch passed on 2026-10-21. The WebView uses a dedicated `$LOCALDATA/NorthDesktop` data root so it cannot collide with another WebView runtime. Interactive Google sign-in still needs a real provider round-trip; release testing requires the deployed website origin and Supabase redirect allowlist.

## What this actually does

Google sign-in returns directly to the native loopback listener. In Supabase
Authentication → URL Configuration, add `http://127.0.0.1:*/north-auth/*`
to Redirect URLs. The random port and one-use nonce change per attempt;
PKCE exchanges the returned code only inside the desktop app. No hosted
website relay is required. Set Site URL to your actual website, not an
unverified example domain.

- **Application rules, persisted** — a JSON file in the app config dir
  (`north-blocking.json`), shaped exactly like the shared model
  (`camelCase`, `when: always | focus | scheduled`), so the same account has one
  blocking model on every client.
- **Real enforcement** — a background thread scans the process table every 3
  seconds (`sysinfo`); when a rule is active (always-on, during a focus session,
  or inside a running schedule window) the matching processes are **terminated**.
- **Focus sessions** — `start_focus` / `cancel_focus` / `get_focus_state` with a
  wall-clock deadline that survives the window being closed to the tray; the
  tray tooltip shows the countdown.
- **Schedules** — including cross-midnight windows, with the same semantics as
  the shared JS engine (a zero-length window never blocks).
- **Temporary unblocks** — “Pause 5m” with an expiry, identical to the other
  clients. After it lapses the rule re-applies on its own.
- **Enforcement log** — the app shows what it actually ended (`name`, pid, which
  rule, when), and records `refused` when the OS denied the kill, instead of
  implying success.
- **A protected-process denylist** — shells, session managers and NORTH itself
  are never terminated, whatever a rule says.
- **Foreground app usage (Windows)** — while signed into NORTH, a background
  sampler checks every second and records only the foreground executable name and active seconds (idle
  after 60 seconds is excluded; browser processes are excluded to keep web and
  desktop usage separate). It stores at most 90 days locally and upserts daily
  totals into `usage_records` with a stable local collector id and the desktop account's own JWT. macOS/Linux
  collection is not implemented; no window title or content is captured.
- **Tray sync** — the native collector emits a heartbeat every ten seconds to
  keep the account bridge active while North is hidden. Cloud snapshots upload
  about once per minute and appear in website Flow and the extension's Desktop
  activity list. Offline native rules and usage remain local until sync returns.
  Closing the window keeps tracking; tray **Quit** stops it. North does not
  automatically start with Windows.
- The page degrades gracefully in a plain browser (no `window.__TAURI__`) and
  says so, rather than appearing to block things.

## What it cannot do (stated, not faked)

- **Prevent a program from starting.** User-space enforcement means noticing and
  terminating; a blocked app can still launch and be killed a few seconds later.
  True prevention needs a kernel driver (Windows minifilter) or an MDM /
  Endpoint-Security profile (macOS) — out of scope for a normal app.
- **Block websites.** A desktop app does not own the browser; that is the
  extension's job. The UI says so on the account card.
- **Kill protected or other users' processes** — the OS refuses; the attempt is
  logged as `refused` rather than retried.

## Roadmap (nothing faked)

| Milestone | Capability | Approach |
|---|---|---|
| Next | Verified build | `cargo check` + a signed bundle on Windows/macOS |
| Next | macOS/Linux foreground usage | Platform-native foreground-process and idle-state adapters |
| Later | Global shortcuts | `tauri-plugin-global-shortcut` |
| Research | Launch prevention | Driver / MDM profile — documented as unsupported until then |
