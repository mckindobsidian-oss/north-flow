# NORTH — Browser Extension (Manifest V3)

The extension is the only client that can legally block websites and track
browsing: **no web page can do that**, so this is where those capabilities live.
It is a separate, minimal client of the same product — one block list, shared
with the web and desktop apps through the same engine.

## What is real today (no fakes)

- **Website blocking** — the worker asks the shared engine what should be
  blocked right now and applies the answer as `chrome.declarativeNetRequest`
  dynamic rules. Sites are genuinely blocked at navigation time.
- **Focus-session blocking** — start a session from the popup and rules marked
  “During focus” apply immediately; the end time is a wall-clock deadline in an
  `alarms` entry, so it survives the MV3 worker being put to sleep.
- **Scheduled blocking** — rules pointed at a schedule window (including
  overnight windows) apply only inside it. The worker sets one alarm for the
  next moment the verdict can change (`msUntilBoundary`) and re-checks every
  minute as a safety net.
- **Temporary unblocks** — “Pause 5m” on an active rule is an expiry the engine
  honours; the rule re-applies by itself when it lapses.
- **Usage tracking** — time on the active tab is attributed to its domain and
  bucketed per day in `chrome.storage.local`. No page content, URL paths,
  titles, or passwords are ever collected.
- **Badge** — the toolbar badge shows how many domains are blocked right now
  (green while a focus session is running).
- **Legacy migration** — an existing `blockedSites` list is converted into
  rules on first load, so upgrading never silently stops blocking something.

The blocking logic itself is **not** implemented here: `lib/blocking.js` is a
generated copy of `packages/shared-types/blocking.js`
(`npm run sync:shared`), the same file the web, desktop and mobile clients use.

## Load it (developer mode)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select this `apps/extension` folder.
4. Pin the ⚡ icon and open the popup.

## Permissions — why each one

| Permission | Why |
|---|---|
| `storage` | rules, schedules, focus state, per-day usage |
| `alarms` | focus end, schedule boundaries, usage flush — all survive worker sleep |
| `tabs` | attribute active-tab time to a domain |
| `notifications` | “focus complete” alerts |
| `declarativeNetRequest` | the actual blocking (no content scripts needed) |
| `host_permissions` `<all_urls>` | required to block/see any domain the user lists |

## Not built yet (honest scope)

- **Real account auth.** Supabase's OAuth flow cannot run inside an MV3 worker
  without a web-redirect + `chrome.identity` handshake. Until that lands, the
  popup can **link** an account name so you can see what the extension belongs
  to — and it says plainly that rules stay on this device. No sync is implied.
- **Application blocking.** A browser extension cannot see or terminate another
  process; the popup lists app rules as read-only for that reason. The desktop
  client enforces them.
- **Backend posting** of usage — comes with the same auth work.
- A bundled notification icon — add `icon128.png` and remove the `try/catch`
  guards around `chrome.notifications.create`.
