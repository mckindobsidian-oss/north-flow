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
   set-a-new-password screen). The Google button was removed from the UI; the
   provider is untouched in Supabase if you ever want it back. Without real
   values the app still runs normally and the login screen says plainly that
   accounts are not configured.

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

These steps are already done for the project this repo is pointed at, so a
fresh clone normally only needs the two values above. What the app then does
automatically (the code is honest about it):
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
