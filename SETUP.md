# SETUP.md — accounts you create (only when you're ready)

Two free accounts unlock real sync and Google Calendar. Both are **yours**;
NORTH just needs the *public* values from each. Everything below is written
for a non-programmer.

---

## 1. Supabase (accounts, sync, real leaderboard) — ~10 min

**What you need:** one free project. **Which value to give me:** the project
URL and the anon key (both are **public by design** — safe to paste into the
app or chat).

1. Go to https://supabase.com → **Sign up** (free) → **New project**.    - Pick any name (e.g. `north`) and a region near you.
   - The database password can be anything; store it in a password manager —
     it is a **secret** and never goes into the app.
2. When the project is ready, open it.
3. Left sidebar → **Project Settings → API**.
   - Copy **Project URL** (looks like `https://xxxx.supabase.co`).
   - Copy the **anon / public** key (starts with `eyJ…`).
4. Give me those two values (URL + anon key), or put them in
   `react-app/.env.local` yourself:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   Then restart the dev server. Email/password sign-in is already wired, as is
   "Forgot password?" (a real Supabase reset email that returns to a
   set-a-new-password screen). Without real
   values the app still runs normally and the login screen says plainly that
   accounts are not configured.

   **Google sign-in** is wired in the UI ("Continue with Google" on the auth
   screen) but needs its provider enabled before it works. One-time setup:

   1. Google Cloud Console → create/select a project → **APIs & Services →
      OAuth consent screen** (External, app name NORTH) → **Credentials →
      Create credentials → OAuth client ID → Web application**. Authorized
      redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`.
   2. Supabase Dashboard → **Authentication → Providers → Google** → enable,
      paste the client ID + secret.
   3. Supabase → **Authentication → URL Configuration**: set **Site URL** to
      your app's origin and add it (plus `http://localhost:5173` for dev) to
      the **Redirect URLs** allow-list — Supabase rejects `redirectTo` values
      that are not listed.

   For the browser extension, also add its exact callback URL to this allow-list
   (see `apps/extension/README.md`). Email-code sign-in requires the Supabase
   Magic Link template to include `{{ .Token }}` and email confirmation to stay
   enabled. The extension uses an email OTP instead of password-only login;
   the website still follows its own auth flow. For password-plus-second-factor
   protection across the whole account, configure mandatory MFA in Supabase and
   add the corresponding MFA challenge to each client.

   No code change is needed: the OAuth return is adopted by the same boot
   session-restore that handles a password login, and the profile is derived
   from the Google account email by the shared mapper. Google accounts are
   pre-verified, so this does not interact with the email-confirmation
   setting. (Google sign-in ≠ Google Calendar access — that separate consent
   is step 2 below.)

5. **Create the tables** (2 min). Left sidebar → **SQL Editor** → **New query**,
   paste the whole of `supabase/schema.sql`, press **Run**. It is idempotent, so
   re-running is safe. This creates the tables, the row-level security policies,
   and the trigger that gives every new account a profile.

6. **Prove the privacy claim** (5 min, optional but recommended). Sign up twice
   so you have two accounts, then follow `supabase/rls-check.sql`: it
   impersonates each user and checks that one account can never read or write
   the other's rows — including two statements that are *supposed* to fail.

> Google sign-in ≠ Google Calendar access (step 2 below is separate, with its
> own consent screen and minimal scopes).

## 1b. Google Calendar integration (optional, ~15 min)

North reads your Google Calendar events (read-only) and shows them beside your
North tasks. The integration is real OAuth with tokens stored server-side in
Supabase Vault — the browser never sees a secret.

This uses the **existing** "North" OAuth client — no second client, and
nothing to do with the Google *sign-in* callback. The integration's own
callback is the Edge Function.

1. Google Cloud Console → the same project as sign-in → **APIs & Services →
   Library** → enable **Google Calendar API**.
2. **Credentials** → your existing OAuth client → add this as an Authorized
   redirect URI — exactly, including the query string:
   `https://<project-ref>.functions.supabase.co/google-calendar?action=callback`
   (The `…supabase.co/auth/v1/callback` URI used by Google *sign-in* is a
   different URI and does not cover this flow. Google answers an unregistered
   one with `redirect_uri_mismatch`.)
3. Deploy the Edge Function and give it the client's credentials:
   ```bash
   supabase login                                  # or export SUPABASE_ACCESS_TOKEN=…
   supabase functions deploy google-calendar
   supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
   ```
   `SUPABASE_SERVICE_ROLE_KEY` is injected by the platform; do not set it.

   **The project ref comes from `supabase/config.toml`**, which is committed,
   so `functions deploy` needs no `--project-ref` and no `supabase link`
   (if you'd rather not rely on it, `--project-ref qrytzsgcarzpevgelwya`
   is equivalent).

   **Do not remove `[functions.google-calendar] verify_jwt = false`** from
   `supabase/config.toml`. Edge Functions verify a JWT at the gateway *before*
   the function runs, and this function has two browser legs that cannot send
   an `Authorization` header at all:

   - `?action=start` — the app navigates to it via `window.location.assign`
   - `?action=callback` — **Google** redirects the user's browser to it

   With verification left on, both return a platform `401` and connecting is
   simply impossible: `start` never reaches Google, and the callback shows a
   raw 401 page instead of bouncing back to the app with `?gcal=error`.
   Nothing is left unguarded by turning it off — see the comment in
   `config.toml`, and the function verifies the caller's JWT itself on
   `start` (header or the `jwt` query param) and trusts only its own
   HMAC-signed, expiring OAuth `state` on `callback`. Every other action
   (`events`, `status`, `disconnect`) still requires a caller JWT.

   Use `config.toml` for this rather than the `--no-verify-jwt` flag: the
   flag is documented for local `functions serve`, and is reported not to
   apply reliably on deploy (`supabase/cli#4059`). The config file also
   survives every future redeploy.
4. Apply both SQL migrations in the SQL editor, in order:
   - `supabase/migrations/002_integrations.sql` — the RLS-protected
     `integrations` table.
   - `supabase/migrations/004_integration_secrets.sql` — the
     service-role-only Vault bridge (`north_secret_put/get/del`). Without it
     the function cannot store a token at all, and connecting fails cleanly
     with `gcal=error` instead of pretending to succeed.
5. Settings → Integrations → **Connect** (or the Connect button on Calendar).

**Scopes requested:** `calendar.readonly` + `userinfo.email`. North can read
the calendars you can see and nothing else — it never creates, edits or
deletes a Google event, so `calendar.events` (read **and write**) is
deliberately not requested. Disconnecting revokes the token.

**The return leg is real.** Google hands the browser back to the app with
`?gcal=connected` or `?gcal=error`; the app reads that marker once, strips it
from the URL, shows a status line, and immediately runs a real import. On
failure it says so — it never reports "connected" for a grant it could not
persist. The callback verifies persistence before redirecting: the token is
written through the Vault RPC, read back to prove it survived encryption, and
only then is the `integrations` row upserted (a failed row write rolls the
token back).

**Tokens are never stored in plaintext** — not in a table, not in a raw
column. They go through `vault.create_secret` / `vault.update_secret`, and
only the Edge Function's service role can reach those functions.

Failure states are honest: an undeployed function reports "The Calendar
function isn't deployed yet", a revoked grant reports "isn't connected", and
nothing in the UI claims a connection the server does not confirm.

What the app does automatically (the code is honest about it):
   - `react-app/src/lib/sync.js` mirrors every write to these tables and pulls
     them back on the next device — `S.*` keeps its API, only its engine grew
   - the offline queue (`localStorage["north:syncq"]`) retries anything written
     without a connection, so a focus session is never lost
   - the leaderboard is the `leaderboard()` function below — aggregates only,
     signed-in callers only, and it cannot be inflated by a client

One more click once you know your deployment URL: **Authentication → URL
Configuration → Site URL / Redirect URLs** must include it, or confirmation and
password-reset links will return to `localhost`. Details: `DEPLOY.md` §3.

> 🔒 **Never** share or commit the **service_role** key — that one bypasses all
> security. The anon key is meant to be public.

## 1c. Spotify integration (optional, ~10 min)

Settings → Integrations → Spotify is real: the same Edge Function pattern as
Calendar (tokens in Vault, caller-JWT identity, minimum scopes). Manual setup
once:

1. https://developer.spotify.com/dashboard → **Create app**
   - App name: `NORTH` · **Web API** and **Web Playback SDK** APIs.
2. In the app → **Settings → Redirect URIs**, add exactly:
   `https://<project-ref>.functions.supabase.co/spotify?action=callback`
   (Which APIs are allowed: tick **Web API**. For playback control the
   account must be Spotify Premium — Spotify's rule, surfaced honestly in
   the app, not worked around.)
3. Deploy + wire the function:
   ```bash
   supabase functions deploy spotify
   supabase secrets set SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=…
   ```
4. Settings → Integrations → **Connect**.

Scopes requested (minimum): `user-read-playback-state`,
`user-modify-playback-state`, `user-read-email`. North sees the current
track and transport controls — nothing else. Until deployed, the card simply
reports that Spotify isn't available; nothing breaks.

---

## 1d. Mobile app (Expo) — Google sign-in

The mobile app's email/password auth needs only the Supabase URL + anon key
in `apps/mobile/.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
Google sign-in on mobile uses a real PKCE deep-link flow and needs four
one-time manual steps that cannot be done from the repository:

1. **Supabase Dashboard → Authentication → URL Configuration** → add
   `north://auth` to **Redirect URLs**.
2. **Google Cloud Console** → an OAuth client of type **iOS** and/or
   **Android** with the app's bundle identifier (see `app.json`), or reuse a
   Web client per Supabase's Google-provider setup in step 1.
3. Install the native modules: `npx expo install expo-web-browser expo-crypto`
   (from `apps/mobile/`).
4. Use a **development build**, not Expo Go: `npx expo run:ios` / `npx expo
   run:android`. Expo Go handles custom `north://` schemes unreliably on
   modern SDKs.

Until those steps are done, the "Continue with Google" button on mobile says
exactly what is missing; email/password auth works with step 1's env values.

## 1e. Browser extension — real website blocking (~5 min)

The extension is what actually blocks sites; the website configures the rules.
There is nothing to build and no extra account:

1. `chrome://extensions` (or `edge://` / `brave://`) → **Developer mode** →
   **Load unpacked** → select `apps/extension`.
2. Popup → **Account** → **Project settings** → paste the same **public** project
   URL + anon key from `react-app/.env.local`, and optionally the North website
   URL (where *Open North Flow* goes).
3. **Sign in with email** using your North account.

Both values are public by design — RLS on the server is the boundary. **Never**
put a service-role key or an OAuth client secret in an extension: everything in
it is readable by anyone who installs it.

After sign-in the account's rules, schedules and running **Focus Mode** window
arrive through the same `profiles.settings` document the web app writes, so
starting Focus Mode on the website blocks sites in this browser, and ending it
stops. Finished days of browsing usage upload to `usage_records` (domains and
durations only); blocked-attempt counts stay on the device. Signing out clears
the synced rules and returns the extension to local-only blocking.

### Adding your deployed origin

The extension only listens to the origins listed in `manifest.json`
(`externally_connectable.matches`) and `apps/extension/lib/external.js`. Add your
real deployed origin to **both** if it is not already there (`https://north.vercel.app`
is the placeholder). That channel is read-only — it can ask the extension to
re-read the account, never to change what is blocked.

### Verifying that blocking really happens

The browser's own rule set and a real blocked navigation are checked by:

```bash
# with the extension loaded and a debugging port open:
brave.exe --remote-debugging-port=9222     # or chrome.exe / msedge.exe
npm run verify:extension
```

Chromium removed `--load-extension` in 137 (the `--disable-features=` workaround
stopped working after 142), so a browser cannot be launched with an unpacked
extension from a terminal any more — load it through the UI once, then attach.

## 1f. Database migrations — apply in order

The SQL editor runs these idempotent files, in this order:

1. `supabase/schema.sql` — base schema (required).
2. `supabase/migrations/001_focus_sessions_task_id.sql` — focus sessions ↔
   task linking.
3. `supabase/migrations/002_integrations.sql` — the `integrations` table
   (one row per user **and** provider; required before Calendar/Spotify
   connections can be stored).
4. `supabase/migrations/003_social.sql` — the friends graph + the
   `friend_action` / `friend_feed` RPCs (required for the Social screen's
   server features). **Already applied on the current project** — it is
   idempotent, so re-running it is harmless, but it is not needed.
5. `supabase/migrations/004_integration_secrets.sql` — the service-role-only
   Vault bridge (`north_secret_put` / `north_secret_get` / `north_secret_del`).
   **Required before Calendar or Spotify can store a token at all**; without it
   connecting fails cleanly with `gcal=error` instead of pretending to
   succeed. (Also listed in §1b, because Calendar cannot work without it.)
6. `supabase/migrations/005_task_difficulty_description.sql` — adds
   `tasks.difficulty` (`easy`/`medium`/`hard`) and `tasks.description`.
   Optional, in the sense that the app works without it — every other task
   field keeps syncing, and the two extras simply stay on the device that
   typed them. Until it is applied, a task's **difficulty and description
   never reach another device**.
7. `supabase/migrations/20261021190000_usage_device_sources.sql` — adds a
   stable collector id to usage rows and changes the unique key so extension
   and desktop totals from multiple devices can coexist. Existing rows are
   retained as the `legacy` source. It is applied to the current North project;
   apply it to another project before enabling additive multi-device usage
   there. Clients fall back to the old four-column shape until it is applied.

Every migration is written to be safely re-runnable (`IF NOT EXISTS`, `DROP
CONSTRAINT IF EXISTS`), so applying one twice is a no-op rather than an error.

**Migration 005 is worth understanding before you skip it.** The pull path
replaces the local task list with the server's, and `keepLocalTaskMeta`
(`react-app/src/lib/sync.js`) exists specifically so that a server which lacks
these two columns cannot erase what you typed locally. That is a guard against
data loss, not a substitute for the columns: until the migration is applied,
your difficulty and description are visible only on the device that set them.

The app detects absent pieces and degrades honestly ("not connected"/
"unavailable", and the two task fields stay local) — it never pretends a
missing backend row or column exists.

---

## 2. Google Cloud (real Google Calendar) — ~15 min

**What you need:** one project with the Calendar API enabled + an OAuth
"Web application" client. **Which value to give me:** the **Client ID**
(public). The **Client Secret** must stay secret — it lives server-side only
(Supabase), never in this codebase.

1. Go to https://console.cloud.google.com → sign in → **Create Project** →    name it `north`.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:    - User type: **External** (fine for personal use) → fill app name `NORTH`,
     your email → Save.
   - (Optional) add yourself under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add the Supabase auth callback:
     `https://<your-project>.supabase.co/auth/v1/callback`
   - Create → copy the **Client ID** (starts `xxxx.apps.googleusercontent.com`).
5. Give me the Client ID. I'll configure the "Connect Google Calendar"
   button using Supabase's Google provider — a real OAuth flow that requests
   *calendar* permission separately from sign-in.

> 🔒 The **Client Secret** is a secret. Supabase stores it server-side.

---

## What should NEVER be shared or committed

`service_role` key · Google Client Secret · database passwords · any `.env` file
The repo's `.gitignore` already excludes `.env*`.
## Friends database update — 2026-10-24

The existing project is missing its social RPCs. Run the complete contents of `supabase/migrations/20261023160011_secure_social_requests.sql` in the SQL Editor of your existing Supabase project, then refresh North. This additive/idempotent update preserves existing rows and restricts friendship mutations to authenticated ownership-checked request/accept/reject/remove functions. It also enables incoming/outgoing request lists and accepted-friend stats.

The connected migration tool returned `Invalid or expired requestState` twice, so this update has **not** been applied remotely. Reconnect that connector before asking an agent to apply it, or use the SQL Editor directly. No new Supabase project or Google OAuth configuration is needed for this change.

