# DEPLOY.md — putting NORTH live

Everything below is either **already done** or **one click you make**. The
database is already live; what remains is choosing a host for the web client
(the desktop, mobile and extension clients are installed by hand and are not
"hosted" at all).

Status at the time of writing:

| Piece | Where it runs | State |
|---|---|---|
| Database + Auth | Supabase project `qrytzsgcarzpevgelwya` | **Live** — `supabase/schema.sql` applied, RLS on every table, `leaderboard()` present |
| Web client | a static host (your choice, below) | **Ready to deploy** — config committed, production build verified |
| Desktop client | each user's machine (Tauri) | Built from source — `apps/desktop` |
| Mobile client | each user's phone (Expo) | Built from source — `apps/mobile` |
| Browser extension | each user's browser (unpacked / store) | `apps/extension` |

---

## 1. What you need to provide (the only manual part)

Nothing has been invented or hardcoded. The web client needs exactly **two
public values**, and they are the ones already in `react-app/.env.local`:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<the publishable / anon key>
```

- Both are **public by design** (they ship inside the JS bundle) and are
  protected by row-level security, not by secrecy.
- **Never** put the `service_role` key in a frontend variable — it bypasses RLS.
- Vite reads them at **build** time, so they must be set on the host *before*
  the build runs. Changing them needs a redeploy.

You can read the current pair out of `react-app/.env.local`, or re-copy them
from Supabase → **Project Settings → API**. `react-app/.env.example` documents
the same thing for a fresh checkout.

---

## 2. Deploy the web client

The repo already contains both config files; pick **one** host.

### Option A — Vercel (config committed as `vercel.json`)

1. Sign in at <https://vercel.com> with GitHub.
2. **Add New… → Project → Import** this repository.
3. Leave **Root Directory** as the repository root — `vercel.json` already
   builds `react-app/` and publishes `react-app/dist`.
4. **Environment Variables** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for *Production* (and Preview, if you want preview
   builds to sign in).
5. **Deploy**. The build command is
   `npm --prefix react-app ci && npm --prefix react-app run build`.

### Option B — Netlify (config committed as `netlify.toml`)

1. Sign in at <https://netlify.com> → **Add new site → Import an existing
   project** → pick this repository.
2. Netlify reads `netlify.toml`: base `react-app`, publish `dist`. Leave the
   detected settings alone.
3. **Site configuration → Environment variables** → add the same two values.
4. **Deploy site**.

### Option C — your own server / container

```bash
npm --prefix react-app ci
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm --prefix react-app run build
# then serve react-app/dist as static files over HTTPS
```

`react-app/dist` is a plain static bundle: any static host, CDN or nginx
`root` works. There is no server process and no client-side router, so no
rewrite rules are required — `index.html` plus `/assets/*` is the whole app.

---

## 3. Point Supabase at the new origin — **required, one click**

Until this is done, email confirmation links and password-reset links return to
`localhost` and sign-in from the deployed URL can be refused.

In the Supabase dashboard: **Authentication → URL Configuration**

1. **Site URL** → the deployed origin, e.g. `https://north.vercel.app`.
2. **Redirect URLs** → add the same origin, plus a wildcard for preview
   builds if you want them: `https://north.vercel.app/**`.
3. Keep `http://localhost:5174/**` (and `:5173`) in the list so local
   development keeps working.

Also worth a look while you are there:

- **Authentication → Providers → Email**: decide whether "Confirm email" is on.
  It is currently **on**, which is why a new sign-up has to click the emailed
  link before signing in. Turning it off makes sign-up instant (fine for a
  personal project; keep it on for a public one).
- **Authentication → Rate Limits**: the defaults are sensible; leave them.

There is **no CORS configuration to do**. The browser calls Supabase directly
and Supabase's API already accepts browser origins; the security boundary is
the RLS policies in `supabase/schema.sql`, which were verified with
`supabase/rls-check.sql`.

---

## 4. Verify the live deployment

Sign in with a real account on the deployed URL, then walk these:

1. **Sign up / sign in** — a new account gets a `profiles` row automatically
   (the `on_auth_user_created` trigger).
2. **Add a task, then open the app on a second device (or a private window) and
   sign in** — the task is there. That round trip is the whole point of this
   deployment; if it works, the backend is wired correctly.
3. **Trigger a focus session and let it finish** — the total appears under
   Activity, and a row appears in `focus_sessions` (Supabase → Table editor).
4. **Forgot password?** — the email arrives and its link opens the
   "Choose a new password" screen.
5. **Social → Leaderboard** — shows real accounts with server-computed focus
   minutes.
6. **Reload with the network throttled to Offline** — the app still loads and
   still records; the pending writes flush when the connection returns (the
   queue lives at `localStorage["north:syncq"]`).

---

## 5. The other three clients

They are **not** hosted — each is installed on the machine or browser it runs
on, and each uses the same account, database and rules as the web app.

- **Desktop** — `apps/desktop`: `npm install && npm run tauri dev`. Its Rust
  core is the only client that can end blocked applications. Its window UI is
  still the small static shell in `apps/desktop/dist`; pointing it at
  `react-app/dist` would give it the full product UI, which is the next
  milestone noted in that README.
- **Mobile** — `apps/mobile`: `npx expo start`. Shares the vendored blocking
  engine and account mapper; needs `AsyncStorage` and sign-in wired up (its
  README lists the exact steps).
- **Extension** — `apps/extension`: load unpacked at `chrome://extensions`.
  It blocks websites for real today; real sign-in (`chrome.identity` +
  web-redirect handshake) is the remaining piece, so it currently links an
  account *name* and keeps rules on the device.

---

## 6. What is deliberately still manual

These are honest gaps, not oversights:

- **Extension account auth** — an MV3 service worker cannot complete a Supabase
  OAuth handshake on its own; it needs the `chrome.identity` redirect dance.
- **Mobile persistence and sign-in** — `AsyncStorage` is not installed, and
  importing a missing native module breaks `expo start` for anyone who has not
  added it. Its README documents the two-line install.
- **Desktop `cargo check`** — the Rust core was written without a toolchain
  available to compile it; run it once before shipping a signed bundle.
- **Launch prevention** on desktop and app limits on mobile — both need an OS
  entitlement NORTH does not ship. Every UI says so rather than implying
  enforcement that does not exist.
