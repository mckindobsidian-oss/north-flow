# NORTH — Mobile App (Expo / React Native)

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
- **Account sign-in.** The next step after persistence; the shared
  `account.js` mapper is already vendored here and ready for it.

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
