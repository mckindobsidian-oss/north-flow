# SETUP.md — accounts you create (only when you're ready)

Two free accounts unlock real sync and Google Calendar. Both are **yours**;
Focusly just needs the *public* values from each. Everything below is written
for a non-programmer.

---

## 1. Supabase (accounts, sync, real leaderboard) — ~10 min

**What you need:** one free project. **Which value to give me:** the project
URL and the anon key (both are **public by design** — safe to paste into the
app or chat).

1. Go to https://supabase.com → **Sign up** (free) → **New project**.
   - Pick any name (e.g. `focusly`) and a region near you.
   - The database password can be anything; store it in a password manager —
     it is a **secret** and never goes into the app.
2. When the project is ready, open it.
3. Left sidebar → **Project Settings → API**.
   - Copy **Project URL** (looks like `https://xxxx.supabase.co`).
   - Copy the **anon / public** key (starts with `eyJ…`).
4. Give me those two values (URL + anon key). I'll wire:
   - email/password + Google sign-in
   - the Postgres schema + row-level security (nobody reads anyone else's data)
   - the storage layer swap (`S.*` keeps its API — only its engine changes)
   - cross-device sync + the honest leaderboard

> 🔒 **Never** share or commit the **service_role** key — that one bypasses all
> security. The anon key is meant to be public.

---

## 2. Google Cloud (real Google Calendar) — ~15 min

**What you need:** one project with the Calendar API enabled + an OAuth
"Web application" client. **Which value to give me:** the **Client ID**
(public). The **Client Secret** must stay secret — it lives server-side only
(Supabase), never in this codebase.

1. Go to https://console.cloud.google.com → sign in → **Create Project** →
   name it `focusly`.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (fine for personal use) → fill app name `Focusly`,
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
