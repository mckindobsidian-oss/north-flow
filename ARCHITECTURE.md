# NORTH architecture

This document describes the implementation observed in the repository on 2026-10-16. It is the maintained architecture record; detailed setup guides remain useful reference material but do not override the decisions log.

## System shape

```text
Web (React/Vite) ─┐
Browser extension ├─ shared account + Supabase/Postgres/RLS
Desktop (Tauri) ──┤
Mobile (Expo) ────┘
        │
packages/shared-types: account identity + North Flow rules engine
```

The product is local-first: clients render from local state, then synchronize account-owned data when configured and authenticated. The web client is the most complete reference implementation.

## Clients and current evidence

| Client | Implementation | Status |
|---|---|---|
| Web | React 19 + Vite in `react-app/`; primary UI in `src/focusly.jsx`; Supabase connector in `src/lib/` | Implemented; build and automated checks passed on 2026-10-16. |
| Browser extension | Manifest V3 in `apps/extension/`; `declarativeNetRequest`, alarms, local usage accounting, GoTrue REST auth | Implemented; account session is adopted from the signed-in North website through nonce-bound pairing. A real browser run is still needed. |
| Desktop | Tauri 2 shell plus Rust process monitor in `apps/desktop/src-tauri/` | Implemented locally; build/run not verified in this environment. It persists rules locally and does not yet synchronize with Supabase. |
| Mobile | Expo / React Native in `apps/mobile/`; email/password auth, storage adapter, shared rule engine | Partially implemented; native build and device behavior unverified. iOS and Android enforcement need native entitlement/permission work. |
| Cloud | Supabase schema, RLS checks, migrations, Calendar and Spotify Edge Functions in `supabase/` | Implemented in source; deployment and live integration verification are environment-dependent. |

## Focus and tasks

Focus/Pomodoro is the core domain. The web client owns the full timer and persists raw focus-session records. The sync layer maps local records to Postgres and uses an offline queue. Tasks reside in the profile/task mapping and are designed to travel through that same account model. Current clients must not manufacture task or focus results when cloud configuration is absent.

Board/kanban fields and screens still exist in code and schema compatibility paths. They are **Deprecated** product direction, not a feature to extend. A future migration must preserve or export existing user data before removal.

## North Flow

`packages/shared-types/blocking.js` is the canonical JavaScript rule model. `scripts/sync-shared.mjs` vendors generated copies for the web, mobile, and extension clients. Rules cover websites/apps, always/focus/scheduled timing, temporary local unblocks, and a shared running focus window.

| Concern | Source of truth | Enforced by |
|---|---|---|
| Rules, schedules, and focus window | Account/profile settings when sync is available | Each client evaluates the same model. |
| Website blocking | Shared website rules | Chromium extension via dynamic `declarativeNetRequest`. |
| Desktop app rules | Shared shape, currently local desktop file | Tauri Rust process scan/termination; it cannot prevent launch. |
| Mobile limits | Shared shape/UI only | Blocked pending iOS Screen Time/FamilyControls and Android UsageStats/native implementation. |
| Temporary unblock | Device-local expiry | The current device only; intentionally not synced. |

No web page can enforce browser or operating-system blocking. A UI must say whether a rule is configured, locally enforced, or unavailable.

## Cloud and security boundaries

- Supabase Auth provides account sessions when public client environment variables are configured.
- Postgres RLS is the authorization boundary. Schema and checks live under `supabase/`.
- `react-app/src/lib/sync.js` is the web synchronization engine; it queues writes locally, currently pulls before its bootstrap push, and maps data through `sync-map.js`. Whole-document replacement and task-list pruning still require conflict-safety work; see the 2026-10-17 progress entry.
- Calendar and Spotify use Edge Functions. OAuth tokens are intended to remain server-side in Vault; clients receive status/data only.
- The extension may store public project config and its user session locally. It must never contain privileged keys or OAuth secrets.

## Verification boundaries

Automated tests validate shared logic and client decision layers, not an actual Supabase deployment, Google/Spotify consent, native device permissions, a Tauri binary, or a live extension loaded in a browser. Those remain separate verification work and must not be described as completed merely because source code exists.
