# Focusly — Mobile App (Expo / React Native)

The phone client of the same product. It shares the web app's tab structure
and will share the same Supabase account, data and design tokens.

Why Expo: one codebase for iOS + Android, over-the-air JS updates, and direct
access to each OS's screen-time APIs (iOS Screen Time, Android Usage Access)
when device-level blocking arrives.

## Run it

```bash
npm install
npx expo install --fix   # aligns versions with the installed Expo SDK
npx expo start           # scan the QR code with Expo Go, or press a / i
```

## What is real today

- A native shell with the 7 Focusly sections and Apple auto light/dark
  (follows the OS — no toggle, like the web app).
- Honest per-screen notes describing exactly what each section needs and
  which milestone provides it. No mock data is shown anywhere.

## Roadmap (nothing faked)

| Milestone | Capability |
|---|---|
| Supabase phase | Real sign-in (email + Google), account data, cross-device sync |
| Google Calendar phase | Calendar import/sync via the shared integration |
| Mobile-native phase | App limits/blocking via iOS Screen Time API & Android `UsageStatsManager` |
| Polish phase | Port the web components (timer, boards, heatmap) into native UI |

Version pins in `package.json` target Expo SDK 53; if your environment
resolves a newer SDK, `npx expo install --fix` will align everything.
