# NORTH roadmap

Roadmap status is directional. “Implemented” means source exists; “Verified” requires recorded evidence in `PROGRESS.md`.

Android update (2026-10-24): native core screens, Kotlin foreground tracking/overlay enforcement, optional browser access/DNS filtering and existing-account synchronization are implemented. Signed ARM64 release APK and static package checks passed; physical-device verification, native Spotify-player parity, mobile photo-upload controls and terminated-app focus alarms remain separate work. See `apps/mobile/VERIFICATION.md`; do not mark Android production-ready from source/build checks alone.

## Now — focus and truthfulness

Web revamp follow-through (2026-10-17): finish page-by-page polish, consolidate app-level active timer lifecycle, add conflict-safe account reconciliation, verify real OAuth/import/playback, implement Spotify artwork/progress/playlist support, optimize wallpaper and JS payloads, and complete the responsive/accessibility matrix. Consider quick capture and recurring tasks only after shared schema semantics are tested. Current implementation evidence is in `PROGRESS.md`.

| Outcome | Status | Exit evidence |
|---|---|---|
| Web Focus/Pomodoro is the clearest primary flow | Implemented / automated checks verified | Live usability pass and authenticated session evidence. |
| Tasks support focused work and sync through the account model | Implemented | Authenticated multi-device task create/edit/complete verification. |
| Replace stale product claims with maintained source-of-truth docs | Verified | This document set and dated check results in `PROGRESS.md`. |
| Remove Board from active direction without deleting data | Deprecated / removed from active web/mobile navigation | Approved migration/export plan before compatibility code or persisted fields are deleted. |

## Next — North Flow verification

| Outcome | Status | Exit evidence |
|---|---|---|
| Shared rules/schedules/focus model remains the only Guard model | Implemented | Unit tests and shared-copy check pass. |
| Browser sites are blocked by the extension when rules are active | Implemented, unverified live | `npm run verify:extension` against a manually loaded extension. |
| Desktop enforces app rules responsibly | Implemented, unverified live | `cargo check`, Tauri build, and controlled process test. |
| Mobile truthfully configures Guard and later enforces permitted limits | Blocked | Native iOS/Android proof with required entitlement/permission. |

## Then — account and integrations

| Outcome | Status | Exit evidence |
|---|---|---|
| Web account, RLS, and sync are live and safe | Implemented, unverified live | Configured-project test, `verify:rls`, and multi-client reconciliation test. |
| Extension and mobile use the same account model | Partially implemented | Authenticated account/rule/task round-trip on each client. |
| Google Calendar is a read-only, secure integration | Implemented source / Blocked by inactive project and missing provider secrets | Deployed function, OAuth grant, import, disconnect, and failure-state tests. |
| Spotify is a secure real integration | Function deployed / live verification blocked by inactive project | OAuth grant, status/playback test, and honest Premium handling. |
| Social features use server-computed/private data correctly | Implemented source / Blocked | RLS and real-account behavior verification. |

## Later — platform polish

- Port only the proven Focus/task experience to mobile; prioritize dependable native behavior over feature parity.
- Integrate the full product UI into desktop after its Tauri build and Guard behavior are verified.
- Improve performance and accessibility based on measured findings, including the current web initial-bundle warning.
- Consider expanded analytics only when it helps focus without encouraging surveillance, gamified noise, or misleading data.

