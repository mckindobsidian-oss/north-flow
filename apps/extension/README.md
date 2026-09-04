# Focusly — Browser Extension (Manifest V3)

The extension is the only client that can legally block websites and track
browsing: **no web page can do that**, so this is where those capabilities
live. It is a separate, minimal client of the same product.

## What is real today (no fakes)

- **Website blocking** — sites in your block list are genuinely blocked at
  navigation time via `chrome.declarativeNetRequest` dynamic rules.
- **Focus sessions** — start 25/50/90 minutes from the popup; the end time is
  a wall-clock deadline stored with an `alarms` entry, so it survives the MV3
  service worker being put to sleep (a plain `setTimeout` would not).
- **Usage tracking** — time on the active tab is attributed to its domain and
  bucketed per day in `chrome.storage.local`. No page content, URL paths,
  titles, or passwords are ever collected.
- **End-of-session notification** — needs a bundled icon (see below).

## Load it (developer mode)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select this `apps/extension` folder.
4. Pin the ⚡ icon and open the popup.

## Permissions — why each one

| Permission | Why |
|---|---|
| `storage` | block list, focus state, per-day usage |
| `alarms` | reliable focus end + usage flush when the worker is asleep |
| `tabs` | attribute active-tab time to a domain |
| `notifications` | "focus complete" alerts |
| `declarativeNetRequest` | the actual blocking (no content scripts needed) |
| `host_permissions` `<all_urls>` | required to block/see any domain the user lists |

## Not built yet (honest scope)

- **Backend sync** — usage/focus posting to the Focusly account (Supabase
  phase). Today everything stays in `chrome.storage.local`.
- **"Block only during focus"** schedules and category detection.
- A bundled notification icon — add `icon128.png` and remove the try/catch
  guards in `background.js`.
