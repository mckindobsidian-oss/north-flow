# Focusly — Desktop App (Tauri 2)

Why Tauri over Electron: a fraction of the disk/RAM footprint, and the Rust
core is where OS-level integration (app tracking, app blocking, tray, global
shortcuts) naturally lives. If Rust ever becomes the bottleneck, the frontend
is a plain web page and can move to Electron unchanged.

## Run it

Prerequisites: **Rust** (stable) + **Node.js**. Then, from this folder:

```bash
npm install                # installs @tauri-apps/cli (first run only)
npm run tauri dev          # compiles the Rust core and opens the window
```

> The window UI is prebuilt in `dist/` so no frontend build step is needed.
> `npm run dev`/`build` exist for when the frontend grows its own tooling.

## What is real in this scaffold

- A Tauri window + **system tray** (left-click reopens, menu has Quit).
- `start_focus` / `cancel_focus` / `get_focus_state` Rust commands — the shell
  page's Start/End buttons call them, and a running session survives the
  window being closed to the tray (state lives in Rust).
- The page degrades gracefully in a plain browser (no `window.__TAURI__`).

## Honest roadmap (nothing faked)

| Milestone | Capability | Approach |
|---|---|---|
| Next | App usage tracking | Windows: `EnumWindows`/process list; macOS: `NSWorkspace.runningApplications` |
| Next | App blocking / focus kill-switch | Native per-OS (window close/hide + rules); tray enforcement |
| Later | Shared backend sync | Same Supabase account as web/extension/mobile |
| Later | Global shortcuts | `tauri-plugin-global-shortcut` |

`block_app` currently returns an explicit "not implemented" error — it never
pretends to have blocked anything.
