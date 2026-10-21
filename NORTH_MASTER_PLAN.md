# NORTH master plan

## Purpose

NORTH is a calm, Apple-inspired productivity and focus ecosystem. Its primary experience is a reliable Focus/Pomodoro flow that helps a person begin, stay with, and understand focused work. Tasks, planning, and optional integrations support that loop rather than compete with it.

NORTH spans web, browser extension, desktop, Android, iOS/iPadOS, and one shared account/cloud state. A person should encounter one coherent product, not separate trackers with conflicting rules or fabricated sync.

## Product principles

- Minimal and atmospheric: clear hierarchy, generous space, system-native behavior, and only UI that advances focus.
- Honest by default: distinguish configured from enforced, local from synced, and implemented from verified.
- Local-first and resilient: core focus work should remain usable without a network; account-backed data synchronizes once real configuration exists.
- Privacy-aware: collect only what supports the product, never page content or privileged credentials, and enforce account isolation server-side.
- Platform-native: use the capabilities each platform legitimately provides; do not imitate unavailable OS enforcement.

## Product domains

| Domain | Product intent | Status |
|---|---|---|
| Focus/Pomodoro | Timer, focus sessions, completion history, and an honest focus loop | Implemented on web; other clients vary. |
| Tasks | Personal tasks supporting focused work; synchronized through the account model where implemented | Implemented on web and partially mobile; cross-client verification pending. |
| North Flow | One shared cloud rule model for limits/blocking with platform-specific local enforcement | Implemented model and browser enforcement; native enforcement is partial/platform-limited. |
| Authentication and account | One account across experiences via Supabase Auth | Web sign-in is primary; extension can adopt the active web session through explicit one-use pairing. Deployment/device verification pending. |
| Sync | Account-owned focus, tasks, Guard rules/schedules, settings, and supported social data | Implemented in web source; verify against a configured project per client. |
| Google Calendar | Read-only calendar data alongside tasks | Implemented source and Edge Function; Blocked until OAuth/project/function setup is verified. |
| Spotify | Real account connection and playback state/control where Spotify permits | Implemented source and Edge Function; Blocked until OAuth/project/function setup is verified. |
| Social | Account-backed friends/leaderboard features | Implemented source/schema; live security and product behavior need verification. |
| Board / kanban | Historic planning UI | Deprecated. Preserve existing data while planning migration/removal; do not extend. |

## Definition of a truthful feature state

- **Planned**: accepted direction without production implementation.
- **Implemented**: code exists and is integrated enough to exercise locally.
- **Verified**: relevant automated and/or real-environment checks have passed, with evidence recorded in `PROGRESS.md`.
- **Blocked**: needs an external account, credential, entitlement, deployment, device, or decision.
- **Deprecated**: retained only for compatibility or migration; no new work.

## Current product direction

1. Strengthen and verify the web Focus/Pomodoro and task flow.
2. Make North Flow reliable and explicit across web, extension, desktop, and mobile—one rule model, platform-native enforcement, no false claims.
3. Verify secure, real account sync before expanding social or integrations.
4. Bring desktop and mobile forward only where their native capability is real and testable.
5. Plan a safe Board-data migration/removal before removing legacy code.

## Non-goals until explicitly decided

- A generic all-in-one workspace or card-heavy project manager.
- A promise of whole-device blocking from a browser or Expo-only mobile app.
- Fake Spotify, Calendar, social, authentication, or sync demos presented as live integrations.
- Storage or display of secrets in source, documentation, logs, or UI.

