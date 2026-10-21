# NORTH — Desktop App (Tauri 2)

Why Tauri over Electron: a fraction of the disk/RAM footprint, and the Rust
core is where OS-level integration (process inspection, app blocking, tray,
global shortcuts) naturally lives. If Rust ever becomes the bottleneck, the
frontend is a plain web page and can move to Electron unchanged.

## Run it

Prerequisites: **Rust** (stable) + **Node.js**. Then, from this folder:

```bash
npm install                # installs @tauri-apps/cli (first run only)
npm run tauri dev          # compiles the Rust core and opens the window
```

> The desktop UI is its own frontend in `dist/` (plain HTML/CSS/JS). It talks
> to the Rust core for native process monitoring, usage sampling and blocking.
>
> ⚠️ **`cargo check` has not been run yet**: this file's Rust was written in an
> environment without a Rust toolchain. Run `npm run tauri dev` (or
> `cargo check` in `src-tauri/`) first — if `sysinfo`/`chrono` resolve to
> different versions, that is where it will show up.

## What this actually does

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
  sampler records only the foreground executable name and active seconds (idle
  after 60 seconds is excluded; browser processes are excluded to keep web and
  desktop usage separate). It stores at most 90 days locally and upserts daily
  totals into `usage_records` with the desktop account's own JWT. macOS/Linux
  collection is not implemented; no window title or content is captured.
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
