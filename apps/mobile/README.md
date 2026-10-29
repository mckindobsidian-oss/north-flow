# NORTH — Mobile App (Expo / React Native)

## Current Android implementation (2026-10-24)

The native entry is `index.js → MobileRoot.jsx → MobileMain.jsx`. This is native React Native UI with a Kotlin device module, not a hosted website. It uses the existing Supabase project and shared sync/account/rules code. The older scaffold notes below are historical and do not describe the current Android entry.

### Install / build

From the repository root on this Windows machine:

```powershell
./scripts/build-android.ps1
./scripts/verify-android.ps1 -Apk artifacts/North-Android-universal.apk -Architecture universal
node scripts/serve-android.mjs
```

Output after a successful build: `artifacts/North-Android-universal.apk` (0.2.1, Android 8+, ARM/Intel, 32/64-bit). The download script prints a local Wi-Fi URL; open that URL on the phone on the same network. It serves only the APK and download instructions, never source files. Transfer the complete file, open it and allow installation from the transferring app if Android asks. This is a personally signed sideload build, not a Google Play release. Keep `apps/mobile/.signing/` private and backed up securely; it is needed to sign future updates. Never commit it. If installation fails, connect an authorized USB-debugging phone and run `./scripts/install-android.ps1` to obtain the actual INSTALL_FAILED code. Do not uninstall an older build without preserving any unsynced local data.

Native monitoring does not run in Expo Go. A development build can be launched with `npx expo run:android` after installing dependencies and an Android toolchain. Public Supabase configuration is taken from the existing web environment at build time; never put a service-role key into mobile config.

### Required one-time setup

1. In the **existing** Supabase project → Authentication → URL Configuration, allow `north://auth`. Google continues to use the existing Supabase Google provider. No separate Android Google client secret is embedded.
2. Sign in on the phone with the same North account. In Flow, use **Refresh sync** to reconcile saved edits, rules and usage. The status line reports sync success or a recoverable error.
3. In North Settings, grant **Usage Access**, **Display over other apps** and notification permission, then enable monitoring. These are explicit Android settings; North cannot grant them for you.
4. Optional: enable **North browser access** in Accessibility for supported-browser address-bar attribution. Only domain names are retained; unsupported/hidden address bars fall back to app usage. Without this permission browser time is app time, not fabricated website time.
5. Optional: enable website DNS blocking and approve the Android VPN prompt, then tap Enable again. This local DNS filter does not inspect TLS; secure DNS/cached connections can bypass it, and Android permits only one VPN at a time.

### Scope and safety

- Native Home, Focus, Tasks, Calendar, Flow, Social and Settings; existing account appearance, tasks, focus history, streak flags, hidden items, rules and usage records.
- Foreground service with a visible notification, screen-lock checks and no inferred suspension gaps. Browser time replaces app attribution to avoid double-counting. Offline counters are owner-scoped and uploaded with stable per-device/day/target keys.
- Shared website budgets include cached account totals, refreshed every 30 seconds while online. This is eventual consistency, not an atomic quota lock across offline devices. Android package IDs and Windows executables remain different app targets.
- Auth tokens use SecureStore/Android KeyStore, backup is disabled, and logout stops monitoring and removes active native credentials. No microphone/storage access is needed for completion sounds.
- A physical phone is still required to verify permission dialogs, battery restrictions, browser coverage, Google return and enforcement. See `VERIFICATION.md` for honest test status. iOS Screen Time enforcement and store submission are **not** included.

## Historical scaffold documentation (superseded above)

The phone client of the same product. It shares the web app's tab structure,
its blocking model, and (once the backend lands) the same Supabase account.

Why Expo: one codebase for iOS + Android, over-the-air JS updates, and a path to
each OS's screen-time APIs when device-level blocking becomes possible.

## Run it

```bash
npm install
npx expo install --fix   # aligns versions with the installed Expo SDK
npx expo start           # scan the QR code with Expo Go, or press a / i
```

## What is real today

- A native shell with the 7 NORTH sections and Apple auto light/dark (follows
  the OS, like the other clients).
- **A working Block screen**: add and remove website and application rules, set
  when each applies (Always / During focus / Scheduled), create schedule windows
  (with a day picker), start and end a focus session, and pause an active rule
  for a few minutes.
- **The same verdict as every other client**: the screen imports the shared
  engine (`./shared/blocking.js`, generated from `packages/shared-types` via
  `npm run sync:shared`), so “blocked right now, because …” matches what the
  extension and desktop app enforce. A live 15-second clock keeps it honest as
  schedules open and close.
- Honest per-screen notes elsewhere, describing exactly what each section needs
  and which milestone provides it. No mock numbers anywhere.

## What is deliberately NOT here yet

- **Enforcing app limits on the device.** iOS requires the Screen Time /
  `FamilyControls` entitlement; Android requires `UsageStatsManager` plus a
  user-granted *usage access* permission. Both are native modules that need a
  custom development build — they cannot ship through this Expo shell. The Block
  screen says this in the app rather than implying your phone enforces anything.
- **Persistence.** `@react-native-async-storage/async-storage` is not a
  dependency, and importing a module that is not installed breaks
  `npx expo start` for anyone who has not added it. So rules live in memory for
  the session and the UI says so. To add it:

  ```bash
  npx expo install @react-native-async-storage/async-storage expo-notifications
  ```

  then put the read/write behind `Blocking`'s `useState` (a ~10-line change) and
  the focus timer's chime/notification behind `expo-notifications`.
- **Account sign-in.** **IMPLEMENTED (email + password).**
  `lib/supabase.js` + `lib/auth.js` + `AuthScreen.jsx` provide real sign-in,
  sign-up (with the web app's confirmation flow), session restoration and
  sign-out, reusing the same shared `account.js` mapper and the web client's
  sync engine. Configure by setting `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` (both public values) before `npx expo start`
  — e.g. in `.env.local` inside `apps/mobile/` (gitignored) or your shell.

  **Persistence:** install the optional peer dependency so sessions and data
  survive restarts — `npx expo install @react-native-async-storage/async-storage`.
  Without it everything still works for the current app run (in-memory), and
  the app says so honestly.

  **Google on mobile:** not wired yet, deliberately. Expo requires either
  `expo-auth-session` with a registered deep-link scheme + development build,
  or `expo-web-browser` with a deep-link `redirectTo` allow-listed in the
  Supabase dashboard. Both need native configuration that cannot be verified
  from this environment, and a faked flow would be worse than none. The
  email path is complete; Google is the documented next step.

## Roadmap (nothing faked)

## Bringing the phone into the account/sync architecture (Step 2 prep)

The web client defines the pattern; the phone should copy it, not invent a
parallel one. In dependency order:

1. **Persistence first, sign-in second.** `@react-native-async-storage/async-storage`
   is prerequisite to everything: without it there is nothing to sync into.
   It slots under the same key scheme (`u:<un>`, `bd:<un>`, `fs:<un>:<date>`,
   `sess`) so `lib/sync.js`'s push handlers work unchanged — that module only
   requires a `store` with `get/set/list` and `localStorage`-shaped async
   methods, which AsyncStorage satisfies directly. This is a thin adapter,
   not a rewrite.
2. **Add `@supabase/supabase-js` and reuse the account mapper.** Sign-in via
   `auth.signInWithPassword` (email+password; the same provider the web app
   uses — no OAuth setup needed on the Supabase side). `toAppUser` +
   `hydrateProfile` from the vendored `shared/account.js` map the result
   exactly as the web does; `un` is derived identically, so the same person
   lands on the same profile key on both devices.
3. **Then sync.** With `store` (AsyncStorage adapter) + a signed-in user,
   `createSync({ store, client })` from `lib/sync.js` is a copy — no
   modification. Its offline queue, debounce and last-write-wins semantics
   are already covered by the web tests and the live RLS verification.

Not done here on purpose: `expo-notifications` reminders (a separate native
module decision), and app-limit enforcement (needs a custom dev build — see
the roadmap). No fake sign-in UI is added: without the dependencies above,
an auth screen would only pretend to work.

## Roadmap (nothing faked)

| Milestone | Capability |
|---|---|
| Next | `AsyncStorage` persistence + `expo-notifications` reminders |
| Next | Supabase sign-in using the vendored account mapper |
| Supabase phase | Account data + cross-device sync with the web app |
| Native build | App limits via iOS Screen Time / Android `UsageStatsManager`, in a custom dev build |
| Polish phase | Port the web components (timer, boards, heatmap) into native UI |

Version pins in `package.json` target Expo SDK 53; if your environment resolves a
newer SDK, `npx expo install --fix` will align everything.
