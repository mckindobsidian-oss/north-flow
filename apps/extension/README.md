# NORTH — Browser Extension (Manifest V3)

The extension is the **enforcement layer**. A web page cannot stop a browser from
loading a site; the browser can. So North Flow (the `Flow` tab of the web app)
configures rules, and this extension is the client that actually blocks them —
in Chrome, Edge, Brave and other Chromium browsers.

```
        NORTH
          │
   ┌──────┴───────┐
Web app        Browser extension
(configure)    (enforce)
   └──────┬───────┘
      Supabase  ── one account, one rule set
```

There is **no second rule system and no second login**: the extension signs into
the same NORTH account and reads the same `profiles.settings` document the web
app writes.

## What is real today

| Capability | How |
|---|---|
| **Website blocking** | Dynamic `chrome.declarativeNetRequest` rules built from `lib/dnr.js`. The request is stopped **before it leaves the machine** — not a content script hiding a page, and not an overlay. |
| **Subdomains, safely** | A rule for `youtube.com` uses the filter `||youtube.com^`: the domain itself plus subdomains on a label boundary. `www.youtube.com`, `m.youtube.com` and `music.youtube.com` match; `notyoutube.com`, `youtube-example.com` and `myyoutube.com` do **not**. |
| **NORTH block page** | The blocked navigation is swapped for `blocked.html`, which names the domain and the reason (your list / Focus Mode / a schedule) and offers *Open North Flow*. |
| **Focus Mode** | A session started in the web app is published to the account and adopted here, so "Focus Mode" really blocks sites in this browser; when it ends, enforcement stops. The deadline lives in `chrome.alarms`, so it survives the worker being suspended. |
| **Schedules** | Rules pointed at a schedule window (including overnight windows) apply only inside it. One alarm is set for the next moment the verdict can change, plus a once-a-minute safety re-check. |
| **Temporary unblock** | "Pause 5m" on an active rule is an expiry the engine honours; the rule re-applies by itself. Deliberately **device-local** — it never travels to your other devices. |
| **Usage tracking** | Runs in the extension service worker while the browser is open; North's website/dashboard does not need to be open. Active-tab time is durably bucketed by UTC day and survives worker suspension. An opt-in **Also count audible background tabs** setting additionally counts sites with audible media, including while another app is foreground. Daily totals sync to `usage_records` under a stable local collector id, so multiple devices can be summed without overwriting one another; no paths, titles or page content are stored. |
| **Daily website limits** | Per-domain daily minute caps are shared in the account's blocking settings and enforced by the extension against its UTC-day browser usage. Reaching a cap blocks that domain and its subdomains; temporary unblock remains available. This is browser-local tracking, not desktop-app tracking. |
| **Account sync** | The popup opens North's signed-in Flow page after the user clicks **Connect to North**. The extension validates the website session with Supabase, then stores it in `chrome.storage.local` for refresh and background sync. The extension has no separate email or Google login UI. |
| **Badge** | The toolbar badge shows how many domains are blocked right now (green while a focus session runs). |
| **Legacy migration** | An old flat `blockedSites` list is converted into rules on first load, so upgrading never silently stops blocking something. |

A new install starts **empty** on purpose. Seeding a "sensible" block list here
would push rules into your NORTH account that you never chose — a focus tool
should never block something you did not ask it to.

The blocking logic itself is **not** implemented here: `lib/blocking.js` is a
generated copy of `packages/shared-types/blocking.js` (`npm run sync:shared`),
the same file the web, desktop and mobile clients run.

## Install (developer mode)

Nothing to build — the extension is plain ES modules that the browser loads
directly, which is also why there is no bundler step to break.

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this folder (`apps/extension`).
4. Pin the 🧭 icon and open the popup.

> **Testing in CI or from a terminal?** Chromium removed `--load-extension`
> for branded builds in 137, and the `--disable-features=…` workaround stopped
> working after 142 (verified against Brave 154, Edge 154, Chrome for Testing
> 136 *and* 154, and an unbranded Chromium snapshot). There is no command-line
> way to load an unpacked extension any more: use the UI step above, then run
> `npm run verify:extension` to attach to that browser and check enforcement.

## Connect it to your North account

1. Sign in to North in this browser.
2. Open the extension popup → **Account** → **Connect to North**. It opens the
   North Flow page and transfers the active website session to this extension
   through a short-lived, one-use pairing request. The extension verifies the
   session with Supabase before syncing.

The popup follows the selected built-in theme's color palette after account sync. Theme changes from the website prompt an immediate account sync; both clients must be signed into the same North account. Its compact **Usage Stats** and **Usage Limits** tabs show browser-domain totals, a seven-day graph, daily caps, and cap progress; schedules, desktop-app rule status, and account controls stay under **More Flow tools**. **Dashboard** opens the website's Flow tab.

The Supabase project URL and anon key are public by design — row-level security
on the server is the boundary. The extension stores the verified account session
locally so it can refresh and sync while the website is closed. **Never put a
service-role key or OAuth client secret in an extension**; anything in an
extension bundle is readable by anyone who installs it.

After sign-in the account's rules and schedules are adopted, Focus Mode starts
and stops here, and finished days of usage upload. Signing out clears the
account's synced rules and returns the extension to its local state.

### The website ↔ extension channel

The website can ask for status, usage, or an immediate rule re-sync (`north-ping`,
`north-sync`, `north-focus`, `north-usage`) through `externally_connectable`, so a rule you
just edited — or a Focus Mode session you just started — takes effect
immediately instead of at the next background refresh. Account pairing uses a
separate `north-connect` request, accepted only from the exact allow-listed
origins and with a matching, unexpired nonce previously stored by the extension.
The website cannot edit individual blocking rules directly.

To address the extension from a web page, Chrome needs its id. The manifest ships
a public `key`, which pins it for every unpacked install — the id is
`sha256(DER public key)`, first 16 bytes, mapped `0-f → a-p`:

```
hmnbjpojnjdbjjiaocljplajihennmaa
```

North reads that id from `react-app/src/lib/extension.js`, and
`npm run verify:extension` asserts the running browser reports the same one, so
a mismatch fails a check instead of silently breaking the channel. If you
installed from a **store** instead, the id is different — paste yours into the
Flow tab (*Set up the extension* → *Use id*). Only the public half of the key is
committed; a private key is needed only to sign a `.crx`, so nothing sensitive
lives in this repository.

### Adding your deployed origin

`externally_connectable.matches` in `manifest.json` and `NORTH_WEB_ORIGINS` in
`lib/external.js` list the origins the extension will listen to. Add your real
deployed origin (`https://your-app.example/*`) to **both** if it is not already
there — the manifest is the browser's gate, the runtime list is the second check,
and `tests/extension.test.mjs` covers the runtime one.

## Permissions — why each one

| Permission | Why |
|---|---|
| `storage` | rules, schedules, focus state, per-day usage, auth session |
| `alarms` | focus end, schedule boundaries, usage flush — all survive worker sleep |
| `tabs` | attribute active-tab time to a domain; open the block page |
| `notifications` | "focus complete" alerts |
| `declarativeNetRequest` | the actual blocking (no content scripts needed) |
| `webNavigation` | notice the blocked navigation so NORTH's block page can replace the browser's error page |
| `host_permissions: <all_urls>` | required to block any domain the user lists |

No `web_accessible_resources`: the block page is only ever opened by the worker
itself, so ordinary web pages cannot load or frame it.

## Tests

```bash
npm test                     # the decision layer, in Node, no browser:
                             #   domain + subdomain matching, lookalike domains,
                             #   rule planning/diffing, duplicates, empty set,
                             #   focus activation and expiry, temp unblocks,
                             #   daily usage-limit enforcement,
                             #   block-page wording, the message allow-list
npm run check:jsx            # parse every file (the extension has no compiler)
npm run verify:extension     # the part only a browser can answer — see below
```

`verify:extension` drives a real Chromium over the DevTools protocol and checks
that the extension loads, that the browser's own rule set matches the desired
list, that Chrome's URL matcher agrees about subdomains *and* about
`notyoutube.com`, that a blocked navigation lands on the block page while a host
that is not on the list still loads, that removing a rule and ending Focus Mode
take effect, and that the rules survive an extension restart.

It needs a browser with the extension already loaded and a debugging port open:

```bash
# once: load apps/extension via chrome://extensions
brave.exe --remote-debugging-port=9222     # or chrome.exe / msedge.exe
npm run verify:extension
# or: NORTH_CDP=http://127.0.0.1:9333 npm run verify:extension
```

It temporarily adds `youtube.com` and `localhost`, starts and cancels a
one-minute focus session, opens two tabs, and removes everything it added.

## Offline and failure behaviour

| Situation | What happens |
|---|---|
| Supabase unreachable | The last synced rules keep being enforced; the next refresh retries. Nothing is cleared because one request failed. |
| Session expired | The refresh token is used once; if that fails too the extension reports **signed out** and keeps enforcing the local rules. |
| Browser restart | Rules and the focus window live in `chrome.storage.local`, so enforcement is restored from the last good state on startup. |
| Worker suspended | All deadlines are `chrome.alarms`, and every verdict is re-checked at least once a minute. |
| Extension restart / update | `onInstalled`/`onStartup` re-run the same reconcile, so the browser's rules are rebuilt from the stored state. |

## Troubleshooting

| Symptom | Check |
|---|---|
| Flow says **NOT DETECTED** | The extension is loaded, but this page can't reach it. Chrome only injects `chrome.runtime` into pages listed in `externally_connectable` — confirm the origin is in `manifest.json` and `lib/external.js`. |
| Popup shows *Sign in* but the web app is signed in | They are separate sign-ins by design: the extension has no access to the web app's storage, and nothing is shared between origins unless you sign in on the extension too. |
| Google sign-in returns a redirect error | Confirm Google is enabled in Supabase and the exact `chromiumapp.org/supabase` callback above is in the Auth Redirect URLs allow-list. |
| A site is not blocked | Open the popup → *Current website*: it reports Blocked/Allowed from the same verdict the browser enforces. If it says Allowed, the rule is off, scoped to Focus Mode/a schedule, or temporarily paused. |
| Rules added in the web app do not appear | Open the popup and confirm the account is signed in; press **Sync now** on the Flow tab. |
| Need the browser's own view | `chrome://extensions` → the extension → *service worker* → console; the worker logs every reconcile with its reason. |

## Packaging for a store (not automated)

1. Bump `version` in `manifest.json` (Chrome rejects a repeated version).
2. Zip the **contents** of `apps/extension` (the manifest must be at the zip root).
3. Upload to the Chrome Web Store / Edge Add-ons.
4. The store assigns its own id — update the id in
   `react-app/src/lib/extension.js` (or paste it into the Flow tab) and add the
   deployed origin to `externally_connectable` **and** `lib/external.js`.

Nothing here publishes anything automatically.
