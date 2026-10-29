# NORTH progress

## 2026-10-28 — Phone screenshot fixes and account visibility

- Reviewed all 17 supplied screenshots before changes. Confirmed missing icons, oversized wallpaper images, persistent header/status, Today label wrapping, selected calendar-cell height, exposed task/permission forms and empty today usage.
- Implemented: Hi/name home greeting, removable 10-second status, font-independent SVG controls, bounded wallpaper thumbnails, collapsed hidden usage, compact sound controls, task form disclosure and accessible tick/edit/bin actions, native-driver clock digit transition with stable underlay, timer-restore error recovery and fixed calendar/streak slots.
- Implemented: first-account-use Android permission setup with explicit user grants/Skip, one settings management entry and pause control; optional DNS activation removed from main UI, active VPN stop retained. Official Spotify embed (SDK-compatible react-native-webview 13.13.5) in Focus and Tasks, no North credentials injected.
- Implemented: independent settings/usage refresh, per-user usage cache, local/native snapshot merge with uploader device id, stale-range explanation and manual website entry in limit creation. Existing shared queue/rules model retained. Fixed extension PostgREST empty-201 success parsing.
- Live findings: account usage table had 42 rows with newest day 2026-10-24 and zero today rows; mobile cannot display source-device activity that has not reached the cloud. Usage RLS and device conflict index verified. Additive global focus_rankings migration applied; database check returned ordered positive ranks and anon execute=false. Website/desktop own-rank display, mobile global list and extension account rank wired to shared aggregate. Security advisors reviewed; definer access is intentional for authenticated aggregate/social RPCs; existing leaked-password protection setting remains unchanged.
- Verified: all 13 mobile JSX modules parsed; extension syntax/targeted whitespace checks passed. Eight focused tests passed (empty REST responses, owner-scoped queue/Realtime, limit persistence, usage pagination and deduplication). Android build's five auth/crypto checks passed. Offline build stopped on uncached WebView Android Gradle plugin 7.0.4; dependency-enabled retry succeeded in 19m21s. APK 0.2.5 (7) passed signature, 16 KB alignment, all four ABI, permission and backup checks; native WebView registration confirmed. SHA-256 030DF3E054706708CCF352020D0A2BC73720C073A3165B8DC79E15FEDF2AFB3E. Copied to ../North-0.2.5.apk and ../North-Android.apk.
- Verified: web production build passed (30.53s), Windows optimized release compiled (30m12s), MSI and NSIS installers created; NSIS copied to ../North-Desktop-Setup.exe. Extension 0.3.7 packaged as ../North-Extension-0.3.7.zip; reload the unpacked extension for new worker code. Website source/build updated locally; no public deployment performed. adb reports no connected device, so phone/emulator visual, actual Spotify playback, permission grants and authenticated multi-device enforcement remain pending; no credentials entered or data deleted.

## 2026-10-27 — Website navigation and Pomodoro parity follow-up

- Compared the current website's north-mobile-nav styles and Focus dial composition directly with native source. Replaced the five-tab/More menu with MobileNavigation: all seven tabs visible, 4+3 rows on phones, one row at 560px+, floating glass dock, themed selected icon/label/pill, safe-area offset and 50px touch targets. Added content clearance below the dock.
- Focus now shares the same flip-clock/phase-pill/dial/icon-control composition between normal and immersive modes. Matched website dial geometry, countdown typography and phase color roles; added accessible Reset, Start/Pause, Skip and Expand controls. Skip changes phase without awarding focus completion. Combined the Focus heading and expand/settings icons, and left-aligned the working-task selector. Top-left close remains in immersive mode.
- Verified: three changed mobile JSX files parsed with installed Babel; targeted diff whitespace check passed. Build's five mobile auth/crypto checks passed. Universal APK 0.2.4 (6) built successfully in 5m33s; APK v2 signature, 16 KB alignment, four ABIs and permission/backup checks passed. SHA-256 CFF50B7EC3F20DF6D664EB7E1A017C596CE5E878E40450CC94E41CC7435B7F00. Copied to ../North-Android.apk and ../North-0.2.4.apk. Native runtime review blocked: configured Pie64 endpoint 5555 refused connection and no HD-Player process was running. No authenticated UI visual-test result claimed.

## 2026-10-27 — Native mobile UI alignment

- Implemented: shared native wallpaper/theme provider using the website assets and environment accents; neutral translucent cards, readable inputs, larger secondary text and labeled wallpaper choices. Auth now opens over Violet Dusk with a restrained glass form and violet primary action, replacing flat black/blue.
- Implemented: Home greeting/start-session/Today hierarchy; five-item bottom navigation (Home, Focus, Tasks, Flow, More), with Calendar/Social/Settings in More and a header settings shortcut. Navigation preserves the mounted focus timer and scrolls back to the screen top.
- Implemented: circular SVG Pomodoro progress dial, task selector, phase controls, settings disclosure, immersive focus view with the same countdown and a native animated hours/minutes/seconds clock, respecting reduced motion. The Spotify playlist opens externally with theme-matched presentation; embedded Spotify-player parity remains pending.
- Implemented: Flow charts are independent of a large enclosing card, line chart enlarged with minute-axis labels and theme accent; Yesterday selection now highlights. Common cards/forms/nav/calendar/tasks/social receive the shared visual treatment. Existing sync, authentication and native permission/enforcement behavior retained.
- Verified: six changed mobile JSX files parsed with installed Babel parser; targeted whitespace check passed. The slow broad parse was stopped in favor of these scoped checks. Build's five existing crypto/storage checks passed. Universal APK 0.2.3 (5) built successfully in 8m31s; signature, 16 KB alignment, four ABIs, disabled backup/debug and permission checks passed. Size 77,895,991 bytes; SHA-256 C4DD031ADEECADBFE872F55BB26427DD986B080C04712EE3D1356555A3D9054F. Copied to ../North-Android.apk. Emulator endpoint 127.0.0.1:5555 refused connection, so no new runtime screenshot or phone validation is claimed. Previous emulator encrypted-storage blocker remains unresolved.

## 2026-10-26 — Android white-screen crash fixed; secure-storage runtime blocker

- Found the white screen followed a Google-button JavaScript crash: the APK lacked the ExpoWebBrowser native module. Pinned expo-web-browser 14.2.0 and expo-crypto 14.1.5 to Expo SDK 53 recommendations; generated native registry now includes both modules. Added a missing-component guard and native secure randomness/SHA-256 PKCE bridge to avoid Supabase's plain challenge fallback.
- Kept encrypted session storage. Invalidated ciphertext reads can start a fresh sign-in; other storage errors propagate. New writes use the north.auth.v1 keychain namespace with legacy reads, readback verification before publishing the chunk manifest, and logout cleanup in both namespaces. No plaintext token fallback, user-data reset, cloud schema or provider changes.
- Five focused regression checks passed. Universal release 0.2.2 (4) built successfully; APK signature, 16 KB alignment, all four ABIs and backup/permission checks passed. Size 77,886,655 bytes; SHA-256 0EF46E65DB0C92FF5B617EA078241824D74253F42F03E12E9AA041D6A8CC34FC. Copied to ../North-Android.apk.
- Installed with adb install -r on the running Android 9 Pie64 instance (its local port changed to 5555). Launch returned Status ok; North's native login screen renders. One Google-button test left the process alive with no scoped runtime crash or plain-PKCE warning, but fresh encrypted-value readback still failed and showed an explicit error. Login is NOT verified. Earlier default-key readback also failed; a shell-only keystore probe was killed and is inconclusive. No credentials entered or accounts created.
- Next: test secure sign-in on another Android instance/device. Do not bypass encrypted storage to make the emulator pass. Authenticated sync, native monitoring and blocking remain unverified; physical Oppo installation/Play Protect remains separate.

## 2026-10-26 — Android installation and first launch verified

- Verified on the user's running BlueStacks Pie64 instance: local adb endpoint 127.0.0.1:5556 reports Android 9, with x86_64/x86/ARM compatibility. The earlier 5555 endpoint was offline; no host security settings were changed.
- Installed the existing universal release APK with `adb install -r`: Android returned `Performing Streamed Install / Success`. Confirmed installed package com.north.mobile via package manager. No rebuild, uninstall or data reset performed.
- Launched com.north.mobile/.MainActivity with `am start -W`: Status ok; process remained alive and resumed. Scoped process logs contained no AndroidRuntime:E or ReactNativeJS:E entries. Screenshot of North's foreground screen (`.tmp/north-android-launch.png`) confirmed a fully rendered native login UI with email/password and Google options.
- Pending user action: sign in inside the emulator manually. No credentials read/entered and no auth bypass performed. Account roundtrip, authenticated screens, monitoring permissions, actual blocking, offline/reconnect and multi-device usage remain unverified. Installation on BlueStacks does not resolve or explain the Oppo Play Protect warning.

## 2026-10-26 — mobile runtime setup still blocked

- Verified: BlueStacks installer publisher signature remains Valid (Now.gg, INC); an existing BlueStacks Store window opened after explicit user authorization restricted to BlueStacks.
- Blocked: Computer Use cannot capture its window (`FrameArrived timed out`, then `window capture timed out` on the recovery attempt). Stopped UI control without clicking unobserved setup controls. adb reports no connected Android device; Store presence is not proof of a working Android App Player.
- No North code changes or new APK/runtime results in this attempt. No security settings, reboot, account credentials or user data were changed. Installation/launch, live monitoring and blocking still need a booted emulator or phone. See apps/mobile/VERIFICATION.md.

## 2026-10-25 — installable distribution and explicit Flow refresh

- Implemented: Android 0.2.1 (3) universal release, compiling and packaging arm64-v8a, armeabi-v7a, x86 and x86_64 with the existing private signing key. Android 8+ remains the minimum; this is not an all-OS compatibility claim.
- Verified: release build, APK v2 signature, 16 KB ZIP alignment, expected ABI list, disabled backup/debug and sensitive-permission checks. APK is 77,884,255 bytes; SHA-256 `642988E80510D0CA607876201185DAB9D8D30EF6ED287B73B7AEDF8947434C8A`.
- Implemented: APK-only local download page (`node scripts/serve-android.mjs`, port 5176), correct attachment/MIME/length, resumable ranges, checksum and no repository/static-directory access. Verified HTTP 200/206, APK ZIP prefix, and 404 for `.env`. Convenience artifact copied to parent North/North-Android.apk. `scripts/install-android.ps1` can capture a connected phone's exact installer error without uninstalling or erasing data.
- Implemented: Refresh sync lives in Flow, not the global header/sidebar. Web/desktop await account reconciliation and desktop usage upload, request extension upload/pull/enforcement, then reload; web preserves a short confirmation and does not claim an unconfirmed extension connection. Extension uploads usage before pulling rules and reloading, with visible failure errors. Android manual refresh waits for background native sync using a separate timed network lock, then fetches account/history and rerenders its native screen; it does not reset a running focus timer.
- Implemented: streak daily-spark hero with real 0/2 objectives, actionable focus/task shortcuts, today highlight, earned-only flame celebration, expandable rewards and reduced-motion support. Native Android uses native views/Animated, not a web view.
- Verified: 62 targeted desktop/streak/extension/sync-queue tests passed; all 43 checked JS/JSX files parsed; web production and Windows desktop debug builds passed. Existing authenticated browser session was unavailable; no authenticated UI or two-device live test is claimed. Extension browser verification unavailable (no debug browser attached); reload unpacked extension 0.3.6 once.
- Blocked runtime verification: adb found no connected device. Official emulator/system-image installation stalled; an independent official emulator download timed out after 360 seconds at 11,058,178 / 459,732,447 bytes; a range retry also timed out. No emulator was booted, and the Oppo's exact `INSTALL_FAILED_*` cause is still unknown. Static APK verification is not an installation test. Do not label the user's installer problem resolved until a device accepts the APK.

## 2026-10-24 — Android native client, refresh and achievement repairs

- Implemented: native React Native screens for Home, Focus, Tasks, Calendar, Flow, Social and Settings, reusing the existing account, shared blocking model and offline sync queue. Android Kotlin foreground monitor, local overlay enforcement, optional browser URL-bar accessibility integration and optional local DNS VPN. Only observed foreground seconds are recorded; browser attribution replaces rather than duplicates app attribution. No device-admin, root, microphone or storage access is requested.
- Implemented: SecureStore PKCE session persistence, Android KeyStore-encrypted background credentials, account-scoped offline counters and idempotent usage upserts. Native background rules refresh every 30 seconds; existing profile realtime/30-second fallback retained. Shared cross-device quotas are eventually consistent, not an atomic simultaneous-device reservation.
- Implemented: serial streak-day writes prevent task/focus progress overwriting each other; clickable milestone details and recent-day goal indicators. Settings hidden-item selector reuses the themed picker. Removed Home's browsing-summary strip. Visible Refresh controls added to web/desktop, extension 0.3.5 and native mobile.
- Verified: all 177 shared regression tests passed, including concurrent streak completions. Web production and Windows desktop debug builds passed. Browser preview confirmed milestone details, corrected badge sizing, themed hidden picker, visible Refresh and successful preview reload. Android prebuild, Metro export, Kotlin/C++ compilation, release lint and signed APK assembly passed. Final ARM64-only APK (40,086,436 bytes) passed signature/alignment/permissions/backup checks. No Android device was connected: Google return, live enforcement, offline/account-switch and multi-device phone scenarios remain unverified; see apps/mobile/VERIFICATION.md.
- Manual: allow `north://auth` in the existing Supabase redirect list, install the signed APK when produced, then explicitly grant Usage Access/overlay and optional accessibility/VPN permissions. No iOS enforcement or App Store release is claimed.

## 2026-10-24 — wallpaper persistence, Focus and daily milestones

- Implemented: dated account appearance with custom compressed photo/adjustments, signature inclusion, newest-appearance merge on push/pull and account-scoped local recovery. Violet Dusk default in shared clients. Extension 0.3.4 consumes custom/preset appearance on popup and block page.
- Implemented: themed visited website/app selector in Settings, app exclusion from Flow charts/totals, normal Focus phase controls, auto-dismiss completion feedback/return from immersive, repaired split-flap lifecycle and centre-hinge animation.
- Implemented: sound slider captures values synchronously, local responsive state and ordered saves; different task/focus/break/streak/achievement sounds. Home flame, daily dual-objective progress and expandable earned milestone badges, synced via additive account day flags. No arbitrary click sounds.
- Verified: focused appearance regression proves changed theme fingerprints, custom-photo mapping round trip, preservation against a stale device profile push and queued retry on a concurrent-update conflict. Browser preview retained Luminous Violet across navigation out of Settings and a full reload. Supabase profiles_touch trigger is present for updated_at conditional writes. Web and native debug builds succeeded. Other new behaviors were not repeatedly tested, per user request. Native/installed-extension multi-device behavior is not yet verified.

## 2026-10-23 — login, tracking gaps, shared limits and hourly activity

- Fixed Google account existence checks before sync attachment; added and applied an additive onboarding marker migration preserving all six existing registered profiles. Auth boot/event adoption now coalesces, and a new Google login without completed North signup routes to signup instead of fabricating a profile.
- Routine extension sync no longer writes stale profile settings back. Remote cache writes bypass local queuing explicitly; in-flight pulls abandon stale results after a local edit; flushes retain writes that arrive during upload.
- Extension 0.3.1 binds timers to browser-session storage, drops overnight/unobserved gaps over 90 seconds, rechecks focus/idle state periodically and correctly closes foreground session intervals at tab switches. Historical aggregates are preserved, including any old inflated totals that cannot be reconstructed.
- Windows Search/shell apps are excluded from collection and reporting. Added hourly buckets for desktop and browser collection, account-scoped storage and the hourly column in usage_records. Shared snapshot merging prevents duplicate collector snapshots and sums distinct devices. The extension reads account activity, including desktop and other browser collectors, and supports range totals and hourly/daily graph data.
- Today/Yesterday highlight consistently. Flow uses hourly lines for quick single-day views and daily lines for custom ranges; charts label UTC explicitly. Real filled SVG pie slices replace donut cutouts. Historical daily-only rows remain daily totals, not invented hourly points.
- Mixed website/app selections are retained for all four modes; desktop session caps are enforced locally. Replacement limits only replace the selected kind/target. Native daily caps include cached totals from other desktop collectors. Extension limit rows show allowance, remaining daily time and schedule details.
- Added opt-in interface sounds in Settings, preserving separate completion sounds and reduced-motion button/row transitions. Fixed the mobile shared-sync import path; mobile enforcement and device verification remain unfinished.
- Relevant existing JS checks: 99 passed. New regressions and related usage/realtime checks: eight passed. Native checks: three passed, including account-scoped daily/session caps. Updated JSX and wiring checks passed in their targeted runs. Native debug rebuild succeeded with the updated React frontend. Live Google/provider and installed-extension round trips still need real signed-in verification.

## 2026-10-23 — desktop foreground usage, blocking and shared reporting

- Windows usage now samples at one-second resolution rather than five-second increments, skips wake-up gaps, persists every ten samples and on tray Quit. Foreground executable detection excludes browsers/protected processes and 60-second OS idle time.
- App blocking now matches only the requested executable, ignoring case and .exe suffix, preventing substring rules from closing unrelated applications.
- Native ten-second heartbeat triggers authenticated bridge sync even when North is in the tray. Failed profile flushes no longer immediately pull over pending offline edits.
- Extension now fetches today's account-owned desktop records during account sync, reconciles collector/legacy totals, and displays Desktop activity separately from browser time. Account/day cache validation and sign-out cleanup prevent another account seeing those records.
- Eight focused JavaScript checks and the native exact-match blocking check passed. Updated native debug executable built successfully. Local website returned HTTP 200 with the real North entry at http://127.0.0.1:5174/. Authenticated background upload/receive and controlled app termination still require a live signed-in run; no full-suite repetition was performed.

## 2026-10-22 — project audit and foreground-only tracking

- User reports Supabase loopback redirect configuration saved; desktop sign-in retry remains unverified.
- Browser tracking now selects only the focused window's active HTTP(S) tab and pauses at OS idle/lock (60 seconds). Removed background-audio participation, including legacy enabled preferences. Added idle permission; extension reload is required. Historical totals are preserved.
- Three targeted tracking/manifest checks and worker syntax passed. No full suite or native rebuild repeated.
- Recorded current findings and release gaps in AUDIT-2026-10-22.md, including local-only allowance counters, sync conflicts, mobile's incorrect shared-engine import, and pending release/runtime verification.

## 2026-10-22 — Realtime updates and desktop handoff

- A live sign-in attempt exposed a fallback redirect to localhost:3000. The configured example hosted origin serves a different application. Desktop OAuth now returns directly to its native nonce-bound loopback listener; Supabase must allow `http://127.0.0.1:*/north-auth/*`. Real Google sign-in remains unverified until that dashboard configuration is saved and retried.
- Flow adopts account limit changes while open. Realtime subscriptions ignore delayed events after disconnect and refresh the profile on rejoin.
- Reconnect refreshes flush pending edits first and retain local data when upload fails. The targeted Realtime regression check passed.
- Rebuilt the native debug executable with these changes and verified the NORTH window was responding. Interactive Google sign-in and a full installed-extension account/limit/blocking round trip remain release checks.

## 2026-10-21 — Flow readability, extension and native desktop continuation

- Implemented denser theme-aware reading surfaces and brighter secondary text for preset/custom backgrounds; replaced Flow's browser-native date fields with an accessible themed calendar popover that escapes the mobile dock. Combined website/app summaries, removed Selected total and blocked-attempt UI, and simplified hidden-website copy.
- Implemented a continuous extension popup layout, one visible account limits list (websites/apps/rules), shared theme accents/wallpapers for the popup and block page, and the current North mark on the block page. Native browser request blocking remains the enforcer.
- Current-day extension usage now uploads during sync. Flow reads today's cloud records without a local extension and reconciles its live local snapshot by maximum instead of counting the same snapshot twice. Pie charts include the long tail as Other. The live project now has the additive device/source migration, so separate extension and desktop collectors can coexist without overwriting each other.
- Added four synthesized completion sounds with volume and preview, saved through the existing Pomodoro profile. Focus remains mounted when navigating to other tabs; preview browser verification confirmed a running countdown continued through Tasks and back to Focus.
- Desktop now bundles the full React frontend with a native bridge for account rules, app usage and sign-out isolation. Corrected a duplicate Tauri command annotation, missing state initialization, and clock-variable shadowing in native limit evaluation. Generated desktop package icons from the supplied North logo. The debug executable builds at `apps/desktop/src-tauri/target/debug/north-desktop.exe`.
- Desktop Google sign-in now uses a PKCE code returned through a nonce-bound `127.0.0.1` listener; only the one-use code/error is emitted back to the app. The website's normal Google flow is unchanged. Rust and JS tests cover the relay shape; an interactive Google provider round-trip still needs a real signed-in run and the deployed redirect allowlist.
- Added the idempotent usage-source migration and client fallbacks: extension and desktop rows now carry stable local collector ids, while Flow sums per-device rows and avoids double-counting legacy overlap. The migration was applied to the live North project and confirmed with 29 existing usage rows retained and both new columns present.
- Verified the web production build, 41-file parse check, 159 unit tests, native OAuth callback coverage, shared-module check, and the native debug build. The responsive audit passed previously across all 15 viewports × 7 screens, but a fresh capture was blocked by the temporary Chromium launcher in this environment; the Vite site remains live locally on `http://127.0.0.1:5174`.
- Live Supabase project status is ACTIVE_HEALTHY. Older notes requiring project reactivation are historical. The existing real two-account RLS/sync verifier passed all 28 scenarios and cleaned up its marked test records. The built executable is at `apps/desktop/src-tauri/target/debug/north-desktop.exe`; the native smoke launch now stays running with NORTH's dedicated `$LOCALDATA/NorthDesktop` WebView root. Interactive Google sign-in still needs a real provider round-trip.
- Updated extension verifier to use Chromium's supported temporary-profile CDP installation. The earlier live run verified DNR matching, subdomain/lookalike boundaries, focus activation/deactivation and the themed block-page redirect; the current Chrome/Brave build times out at `Extensions.loadUnpacked`, so the full live verifier remains unclaimed. Static and decision-layer tests still pass.
- Added the account-scoped Supabase Realtime invalidation path for `profiles` and `usage_records`; the live publication now contains both tables. Events trigger the existing RLS-protected pull, while polling and visibility refreshes remain the fallback when Realtime is unavailable.

## 2026-10-19 — Flow duration and extension account handoff

- Flow analytics now format tracked duration as seconds, minutes, hours, and days, including totals, averages, chart tooltips, and daily-limit progress.
- Added a direct hide/unhide list for website usage reporting; the preference is account-synced while each browser's raw website usage remains local.
- Removed the Flow advanced-controls disclosure from the visible UI.
- Replaced extension email/Google/local-name login UI with one Connect to North button. It opens Flow with a five-minute, one-use nonce; the extension accepts the signed-in website session only from an allow-listed origin and verifies it with Supabase.
- Verified `npm test` (149 passing), `npm run check:jsx` (35 files), `npm run build`, and `git diff --check`. Browser runtime pairing and real Supabase account-switch verification still require a manually loaded extension and a live signed-in browser.

## 2026-10-19 — supplied transparent logo and default Spotify playlist

- Removed the white canvas from the supplied North logo while preserving its dark app tile and purple mark; the square transparent mark is now used by the web favicon, sign-in/sidebar/mobile branding, and extension toolbar/popup.
- New Focus installs now use the supplied Spotify playlist by default; an existing user-selected playlist remains preferred and can still be changed.
- Audited the current account/sync implementation. Web and mobile share the sync engine; the MV3 extension uses cached rules and REST sync; the Tauri app has a separate REST auth/rule/usage path. All eight live public tables have RLS enabled with owner checks. Realtime subscriptions are absent; web list/profile conflict behavior remains last-write-wins, and app usage upserts by account/day/kind/name (so same-day usage from multiple devices is not safely additive). Desktop authentication is email/password in its current shell, not the website's Google OAuth flow. Focus-session sync is web/mobile-side, not a complete all-client feature.
- Applied two idempotent live Supabase hardening migrations and checked them: removed direct client execution from trigger-only `SECURITY DEFINER` functions (trigger attachments remain intact), and pinned three function search paths. The prior live migration history was empty even though local migration files exist; new migrations are now recorded. Remaining advisor items: intended authenticated aggregate `leaderboard()` and dashboard-only leaked-password protection.
- Verification: **145 tests passed**, JSX parsing, shared-module check, production build, extension manifest parse, migration/grant/search-path checks, and `git diff --check` passed. Live Google/extension authentication, cross-device reconciliation, and browser enforcement still require real product/device tests.

## 2026-10-19 — extension account pairing, wallpaper, and custom-theme continuity

- Removed the popup's manual Supabase key form. Opening a trusted North origin now pairs the extension with the web app's public URL/key; only exact allowlisted origins can do this, and project URLs/public keys are validated (secret/service-role keys rejected). Existing local-link users still see email/Google sign-in while unauthenticated.
- Removed the unused manifest OAuth client-id placeholder; the extension's Google PKCE flow uses Supabase's configured Google provider and the fixed extension redirect.
- Applied the supplied mud wallpaper as the extension's background. Removed Prism Horizon from the website's selectable background choices.
- Fixed tab navigation reapplying the saved account preset over a device-local custom photo.
- Verification: **145 tests passed**, JSX parsing/shared module checks/syntax checks/build/`git diff --check` passed. Live browser install/enforcement and a real OTP/OAuth round-trip remain unverified because no Chrome/Brave CDP endpoint is active; the auth settings read was unavailable in this sandbox.

## 2026-10-19 — Focus clock parity and Flow chart polish

- The animated split-flap local clock now appears in both normal and fullscreen Focus; hours, minutes, and seconds remain visible on narrow/short screens. Focus entry and settings icons no longer have glass button backplates.
- Removed Spotify URL setup from Focus settings and put it inside the floating player controls; it starts minimized when no playlist is configured. Spotify setup remains optional.
- Flow no longer wraps all usage content in one oversized card. The daily chart has more width, while summary/list/chart panels stand independently; usage donuts are larger, flatter, and use a restrained slate/teal palette with total time in the center.
- Verification: `npm test` (**144 passing**), `npm run check:jsx`, `npm run build`, and `git diff --check` passed.

## 2026-10-19 — Focus/Flow screenshot pass, Spotify embed, and extension cold-sync race

- Reset scroll to the top on in-app tab changes, keep Focus Mode controls at the upper-left, and make the focus dial responsive instead of clipping on small screens.
- Restored the split-flap clock animation with correct hinge origins. Spotify is an optional floating window using Spotify's official embed URL; it stays hidden until a share link is configured and minimizes by default on narrow screens.
- Reworked Flow into a screenshot-inspired dashboard with a seven-day trend, actual usage summary cards, all observed targets, and separate desktop-app and website share charts. Hourly sessions are not fabricated; the data source currently stores daily totals.
- Extension sync requests now wait for the Manifest V3 worker's auth restore before reporting/syncing, and Flow's explicit sync action presents the worker's actual result.
- Verification: `npm test` (**144 passing**), `npm run check:jsx` (35 files), `npm run check:shared`, `git diff --check`, and `npm run build` passed. Live Chrome/Brave blocking is still unverified because no browser debugging endpoint is available; loading the extension requires user confirmation.

## 2026-10-19 — extension account setup, verified email sign-in and durable limits

### Implemented

- Removed the confusing Device preferences/right-click-menu controls from Settings and the mobile header; native browser context menus are now always preserved.
- The extension now reveals account configuration when it is missing, describes the required public Supabase values, uses email OTP for existing accounts (`create_user: false`) instead of password-only login, and retains Google OAuth. Google callback validation now checks both exact redirect and an unpredictable OAuth `state` value.
- Improved the extension's glass background treatment and clarified account status: synced rules and limits remain until removed, while daily allowance counters reset each UTC day. Account/profile presentation in web Settings is clearer.
- Confirmed the website limits already serialize with the account's blocking document and are adopted by the extension; their lifetime is independent of the daily usage counter.

### Verification

- `npm test`: **144 passing**; `npm run check:jsx`: all 35 files parsed; `npm run check:shared`: synchronized; `npm run build`: passed (existing chunk-size advisory); `git diff --check`: passed.
- `npm run verify:extension` cannot run the live browser checks because no Chrome/Brave debugging endpoint is listening at `127.0.0.1:9222`.

### External setup still required

- Configure Supabase URL/public key in the extension once, enable the Google provider and allow-list the extension callback, and set the email template to show the OTP token. Email OTP protects extension sign-in from password-only attempts; whole-account password-plus-MFA still needs Supabase MFA configuration and challenge support in the website client.

## 2026-10-19 — consistent translucent materials and focused controls

### Implemented

- Standardized glass surfaces to light, translucent white across preset and custom wallpapers instead of switching dark themes back to opaque charcoal. Applied the same treatment to the desktop sidebar, mobile nav, task picker, Spotify surface, and immersive Focus chrome; reduced-transparency preferences still switch to solid readable surfaces.
- Replaced the immersive Focus “Exit · Esc” control with a close icon at the top-left; Escape remains a keyboard shortcut. The flip clock now appears in Focus itself and the separate screensaver toggle/state is removed.
- Focus preferences are now an icon-only gear. Custom-photo adjustments are hidden by default and revealed from a gear on the custom-image tile; remove-photo is a separate accessible button.

### Verification

- `npm run check:jsx`: all 35 files parsed; `npm test`: **143 passing**; `npm run check:shared`: synchronized; `npm run build`: passed (existing bundle-size advisory); `git diff --check`: passed.

## 2026-10-19 — unified Flow limit creation and lean extension popup

### Implemented

- Replaced Flow's separate quick-cap form with one **Create new limit** dialog: choose from observed websites and desktop apps, select permanent block / scheduled block / daily allowance / per-visit session allowance, enter a duration or schedule, optionally name it, and create.
- Flow usage history offers recorded web/app targets with second-level durations. Saved limits and blocking rules are listed together with their enforcement owner (browser extension or North Desktop). Legacy standalone rule/schedule editors are now under a collapsed Advanced controls section.
- Reduced the extension popup to usage stats, synced usage limits, and account sync. Limit creation is directed to North Flow; duplicate focus, website-rule, schedule, desktop-rule, and audio controls are hidden from the popup.
- Fixed a stale Tauri `active_app_rules` call in `list_running_apps` and kept lock ordering aligned with the enforcement loop.

### Verification

- `npm run check:jsx`: all 35 files parsed; `npm test`: **143 passing**; `npm run check:shared`: copies synchronized; `npm run build`: passed (existing >500 kB bundle advisory); extension manifest JSON and `git diff --check` passed.
- Native Rust compilation and a live Chrome/Brave popup/enforcement run remain unverified. Cargo is not available in this environment; the earlier browser debugging endpoint was not running.

### Next: desktop app phase

- Build and run the Tauri app on Windows, then validate observed-app discovery and usage upload with a signed-in account.
- Exercise permanent, scheduled, and daily app limits end-to-end (including restart, schedule edges, and temporary unblock behavior).
- Decide whether app session limits should be supported by the desktop collector; currently the UI limits that option to websites because desktop session enforcement is not implemented.
- Test process termination safety and startup/close behavior with representative installed apps before calling desktop enforcement complete.

## 2026-10-19 — discovered targets, second-level history and block actions

### Implemented

- The extension Usage Stats lists every website recorded today (not only the top six), and Flow lists every website and desktop app recorded in its seven-day window (not only the top five). Per-site durations display seconds so short visits do not appear as `0m`.
- The extension suggests today's observed websites in its limit input. Flow's observed website/app rows offer **Set limit**, pre-filling the existing shared limit form.
- North's block page offers **+1 minute**, temporarily unblocking the matching active rule before opening the site, and **Website details in Flow**, which opens a Flow deep link with the domain prefilled.
- The extension remembers the exact allow-listed North origin that contacted it (localhost in local development, otherwise the active North domain); Dashboard opens that origin's Flow tab.

### Verification

- `npm test`: **143 passing**; `npm run check:jsx`: **35 files parsed**; `npm run check:shared`: copies synchronized.
- Extension JS syntax and `git diff --check` passed; `npm run build` passed (existing >500 kB bundle warning).
- `npm run verify:extension` could not perform live checks because no Chrome/Brave debugging endpoint answered on `127.0.0.1:9222`. Tauri native build was not verified.

### Boundaries

- Extension history is active-tab based; audible background tabs count only when the user enables that setting. Browser extensions cannot observe browsing while the browser is closed or OS app usage.
- Flow's synced website/app list covers the current seven-day reporting window; today's live per-domain seconds come from the local extension.

## 2026-10-19 — separate desktop and web usage, richer tracking

- Flow can switch between separate seven-day website and desktop-app charts, today totals, and top domains/apps. Website rows come from the browser extension; app rows come from the desktop collector in the same `usage_records` table.
- Desktop Windows now samples the foreground executable every five seconds while an account is signed in, excludes browser processes and idle time after 60 seconds, stores only app names/seconds (90-day local retention), and uploads changed daily totals using the user's own Supabase session. macOS/Linux collection remains unsupported.
- Extension tracking runs without the North website open, survives MV3 worker suspension, and can optionally include audible background tabs across browser windows. Popup now has a seven-day usage graph and an audio-tracking toggle.
- Research checked StayFree's public Chrome listing/user guide and official Chrome extension lifecycle/APIs. StayFree documents audio/video background-tab tracking as optional; Chrome's worker lifecycle supports persistence/event reactivation rather than a permanently-running worker.
- Automated tests (141), JSX/shared checks, browser-script parsing, and web build pass. Rust compilation and live Windows/Brave usage/upload still need a Rust toolchain and authenticated manual test.

## 2026-10-19 — Flow usage features and theme reload recovery

- Added Flow's seven-day site-usage chart and summaries, with real browser usage and blocked-attempt counts.
- Added per-website daily minute limits to the shared blocking model and extension enforcement, with per-browser UTC-day usage.
- Reworked the extension popup into compact North-styled Usage Stats / Usage Limits tabs. Dashboard opens the website's Flow tab; secondary controls remain under More Flow tools.
- Added a durable pending theme-choice marker so a reload/return reapplies the latest selection before stale account hydration and retries an interrupted cloud write.
- Verification for this pass: automated tests, JSX parsing, shared-module consistency, and production build. Live Brave enforcement still needs the unpacked extension reloaded in the browser.

## Theme continuity and compact Flow extension — 2026-10-19

- Root cause: changing a theme only queued the profile write for debounced background sync, while the extension neither read the profile's theme nor reflected it. Returning/reopening could therefore hydrate an older account preference before the new choice reached the cloud.
- Theme selection now explicitly queues and flushes the signed-in profile preference before asking the extension to sync. The extension stores the account theme ID and applies a coordinated accent palette to its popup (wallpaper image files are not duplicated into the extension package).
- Reduced the popup's default footprint and grouped schedules, app-rule status, detailed usage, and account management under a native expandable section. Site blocking, current-site verdict, focus controls, and the Flow dashboard shortcut remain at the top level.
- Dashboard already used `?tab=flow`; verified the app's initial route honors that deep link and retained it.
- Verified: all 137 tests pass, 35 source files parse, shared modules remain synchronized, and production build succeeds (existing Vite bundle-size advisory). A live Chrome/Brave account round-trip still needs manual loading and matching-account sign-in.

## Return-to-app contrast and extension usage — 2026-10-19

- Fixed the washed-out dark-text-on-dark-wallpaper mismatch: the vivid Aurora Lake, Prism Horizon, and Ember Tide scenes now use the light-ink palette, with translucent dark glass instead of bright white surfaces.
- Made active website tracking survive MV3 worker suspension by persisting the active tab/domain/start time, serializing updates, pausing on browser-window blur, resuming on focus, and splitting intervals at UTC midnight.
- Fixed completed-day usage uploads to upsert on the table's actual unique key and advance only after new days. Local usage buckets are archived per account on account changes, and the extension exposes today's domain/time totals and blocked-attempt counts through a read-only message restricted to NORTH origins.
- Flow and Home now show same-day extension usage, recent domain detail, and blocked-attempt counts; they refresh on page return/visibility. App rules remain desktop-enforced; website time comes only from the browser extension.
- Verified: 137 tests pass, 35 files parse, shared generated modules are in sync, and production build succeeds (existing Vite chunk-size advisory remains). Real Chrome DNR/OAuth testing is not available in this session.

## Web Liquid Glass treatment — 2026-10-19

- Tuned the web app toward the supplied lock-screen media-control reference: floating navigation, sheets, the Focus dial and Spotify controls use translucent, softly blurred glass with fine highlights; dense work surfaces stay crisp and sufficiently opaque for readability.
- Added theme-aware tints, layered edge highlights, and restrained saturation. The material system applies across Focus, Tasks, Calendar, Flow, Social, Settings and authentication screens.
- Added solid fallback treatments for reduced transparency, increased contrast, and forced-colors modes. The effect uses standard CSS `backdrop-filter` with a usable tinted surface when unavailable; no browser-specific SVG refraction was added.
- Public design references: [Apple Developer — Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass), [MDN — `backdrop-filter`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter), and [LiquidGlass-UI design guidelines](https://github.com/hwyuanzi/LiquidGlass-UI/blob/main/skills/liquid-glass-ui/references/design-guidelines.md). The design was adapted to NORTH's existing themes and behavior rather than copied from a reference implementation.
- Status: **Refined and build-checked**. `npm run check:jsx`, production build, and 49 auth/extension tests pass. Browser/device visual review remains outstanding.

## Light glass themes, depth and extension manifest repair — 2026-10-19

- Superseded the too-pale Alpine Dawn and Opal Flow wallpapers with three vivid original scenes: Aurora Lake, Prism Horizon and Ember Tide. Aurora Lake is the new default; the existing dark themes remain selectable.
- Increased white-glass translucency/blur, added restrained backdrop depth and hover lift to interactive surfaces, while retaining accessibility fallbacks.
- Reworked the extension popup around one readable light-glass palette with a saturated multicolor backdrop, legible ink, clear input/button states, and layered highlights/shadows. Removed an OS dark-mode separator override that contradicted the forced light palette.
- Follow-up: reduced light-theme white surface fills across web glass, cards, sheets, sidebars, wallpaper scrims and the extension popup to near-transparent tints; retained white ink/highlight details and functional accent states.
- Added Google OAuth using Supabase PKCE and Chrome Identity; tests cover authorization parameters, code exchange/session persistence, and rejection of an untrusted callback. Live sign-in requires Google enabled in Supabase and the callback allow-listed; see `apps/extension/README.md`.
- Fixed the extension's malformed manifest public key. The replacement parses as a valid SPKI public key; its derived Chrome ID matches the web app constant (`hmnbjpojnjdbjjiaocljplajihennmaa`). Added a regression assertion to the extension test.
- Verified this turn: all 136 tests pass, all 34 checked files parse, generated shared modules are in sync, and the production build succeeds (with Vite's existing >500 kB chunk advisory). The local preview is already responding at `http://localhost:5174`; starting a second server correctly reported that port as occupied. A real Chrome load/OAuth consent test remains outstanding because Chrome is not exposed to this session's browser-control surface and OAuth needs project configuration.

## North Flow naming and extension verification — 2026-10-19

- Renamed the customer-facing Guard tab and relevant app/extension/block-page surfaces to Flow / North Flow; the blocking model and rules are unchanged.
- Confirmed the extension's manifest-referenced local files exist and its source parses. 49 automated auth/extension tests pass.
- A real Chromium load-and-block test is still outstanding: no browser debugging session is available to the verifier, and loading the unpacked extension into the user's browser profile requires in-browser confirmation.

## Flip clock screensaver — 2026-10-17

- Added `FlipClock` to the existing Focus screensaver. It reads the browser's local wall clock once per second; it does not create or replace the Pomodoro timer.
- Added original split-flap styling: separated digit groups, center hinge line, dark mechanical panels, digit-change rotation, large desktop layout, and HH:MM fallback on narrow screens.
- Added an accessible `aria-label` with the current local time and disabled the decorative flip animation under `prefers-reduced-motion`.
- Verified in the local preview: Screensaver exposes `Local time HH:MM:SS`, renders six split panels, and keeps the live Pomodoro countdown below it. Production build, JSX check, and lint passed after the change.
- Inspiration research: split-flap mechanics and fullscreen/minimal composition were reviewed from [Retro Flip Clock](https://github.com/kelaocai/retro-flip-clock), [Splitflap](https://github.com/qrion25/splitflap), and [Desmarto's flip clock](https://desmarto.com/flip-clock). No external clock code or media was copied.

## Web revamp continuation — 2026-10-17

This is a **partial implementation** of the major web revamp brief, not a claim that its entire checklist is complete.

### Implemented

- Shared material tokens now distinguish translucent navigation/chrome from unblurred reading surfaces. Added consistent keyboard focus outlines and solid high-contrast/reduced-transparency fallbacks.
- Focus uses a dedicated dark task listbox (`FocusTaskPicker.jsx`) with arrow/Home/End selection, Enter/Space, Escape, single-letter search, scrolling, outside dismissal, selected state, and due labels. It receives the existing profile task collection, not a new task store.
- Session length controls moved from general Settings into a hidden Focus-only panel. Idle timers adopt the new duration immediately; running countdowns are not restarted.
- Removed the extra Focus heading prose, animated decorative orb layer, duplicate Music buttons, and extra Focus readability overlay. Custom-photo dimming now respects the actual slider value; adjustment callbacks now pass the expected object.
- Immersive Focus is portaled outside the app layout, with its own crisp wallpaper, keyboard focus containment and inert background. Optional screensaver hides transport/music without creating another countdown. Escape returns from screensaver first; exit returns to Focus. A browser fullscreen toggle is available.
- Spotify is one collapsible contextual Focus panel; connection management left general Settings. Failed status, disconnect, missing-function and upstream HTTP errors no longer manufacture success. Playback/playlist/artwork expansion is not complete.
- Calendar connection/disconnect management moved into Calendar. Status errors no longer fall through to `connected: true`; cache hydration finishes before the server probe; failed sync preserves cache; disconnect must succeed remotely before local state is cleared.
- Both integration clients now use the same normalized Supabase project URL as Auth, avoiding malformed function URLs when configuration contains an API suffix. This fixes a possible 404 path, but does not establish the historical Spotify NOT_FOUND root cause.
- Environment selection now persists through the profile storage/sync boundary, with serialized writes and navigation waiting for those writes. Profile fallback applies its saved theme. Custom image bytes remain device-local, not cloud uploaded.

### Verification

- Browser checks on the explicitly labeled preview: task selected using arrow/Enter; Focus Settings changed 25 to 30 minutes; timer started/paused; immersive and screensaver transitions preserved the countdown and selected task; Escape restored controls; sidebar disappeared from immersive mode; wallpaper remained visible.
- Browser checks: Settings contains no Spotify/Calendar/timer sections; choosing Violet Dusk survives navigation to Focus; Calendar displays disconnected state without claiming an authenticated connection.
- Desktop and 390×844 mobile layouts inspected. Mobile inspection caught and fixed an unlabeled Focus Settings icon. Full viewport/page matrix, assistive-technology pass, refresh/login theme persistence, background-tab timing and browser fullscreen remain unverified.
- Unit suite: 134 tests passed, including new integration-reconciliation regressions. JSX check: 34 files. Lint clean. Shared-copy check passed. Production build passed; initial JS bundle still exceeds 500 kB. `git diff --check` passed (line-ending warnings only).
- Live Supabase management read on 2026-10-17: only Spotify is listed, ACTIVE version 2. Google Calendar is not deployed. No migration, Edge Function deployment, secret change, or RLS change was made in this revamp continuation. Real OAuth, Spotify playback, Calendar imports and authenticated multi-device sync were not verified.

### Research and choices

- [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials): apply translucent material to controls/navigation, preserve readable content and accessibility fallbacks.
- [Session](https://www.stayinsession.com/): clear session intention and distraction reduction support improving the task-to-timer handoff and quiet screensaver, rather than adding more dashboard widgets.
- [Pomofocus](https://pomofocus.io/): task-linked focus and configurable intervals support the focused picker/preferences workflow.
- [Todoist](https://www.todoist.com/features): quick capture and recurring dates are useful future candidates, but recurrence requires explicit shared-data semantics; do not bolt on a local-only version.
- No external video or media was added. Existing original wallpapers provide the screensaver fallback without decoding overhead, autoplay audio, or new licensing dependencies.

### Remaining work / known risks

- The full page-by-page visual/microcopy sweep and asset/bundle optimization are incomplete.
- Spotify artwork, progress, playlist selection and live OAuth/playback verification remain pending. Calendar requires deployment/provider setup and real import tests.
- Account sync is still whole-document in important paths. Initial pull can replace pending local edits; whole-list task pruning can overwrite concurrent changes. A versioned/conflict-safe reconciliation change needs dedicated tests before claiming safe automatic cross-device sync. This pass did not rewrite that engine.
- Leaving the Focus tab unmounts its timer; a durable app-level active-session lifecycle remains necessary. Screensaver/Focus Mode transitions within Focus preserve the same timer.
- Theme navigation persistence is verified in preview; cloud round trips, logout/login and custom-photo availability on other devices are not. Storage write failure feedback and hydration races still need coverage.
- Chrome extension, native desktop/mobile, and cross-client enforcement/sync were outside this web phase and were not retested.

## Current snapshot — 2026-10-16

### Verified

- `npm test`: **132 passing**, 0 failing.
- `npm run check:jsx`: **33 files parsed** successfully.
- `npm run check:shared`: generated shared modules are synchronized.
- `npm run lint`: clean, with no warnings.
- `npm run build`: web production build completed successfully; Vite reports the existing initial-bundle size warning (~615 kB before gzip).
- The local web preview answers HTTP 200 at `http://localhost:5174/preview.html`.
- Static extension contract, message-handler, manifest, DNR, blocking, account-merge, focus-adoption, reason-page, and trusted-origin tests pass as part of the suite.

### Implemented in this pass

- Web auth now follows live Supabase session events (`SIGNED_IN`, `SIGNED_OUT`, token refresh, and user updates), clears local account state on sign-out, and keeps asynchronous profile work outside the auth callback.
- Password sign-in/sign-up uses that single session authority rather than racing a second account-adoption path. The sign-in/register switch no longer calls a nonexistent state setter.
- Tasks, Calendar, and Focus continue to use the same profile task collection. Focus can complete its selected task and persists that completion to the shared profile.
- Entering Focus Mode starts the timer when needed and publishes the same Guard focus session. Leaving the immersive view no longer silently stops an otherwise-running focus session.
- Calendar synchronization no longer reports a connection when the function returned cached events plus an error, and offline status checks preserve the last verified connection state.
- Home's “All clear” state now accounts for overdue tasks.
- Board was removed from active mobile navigation. Compatibility code/data remains untouched pending a migration plan.
- The extension popup now opens the North Flow dashboard using `?tab=flow`; the web app honors that deep link.
- A restored local profile now retains its last verified account identity while Supabase restores its own persisted session. This prevents an offline/unreachable service from falsely rendering an authenticated person as “device only”; server-side authorization still decides protected operations.
- The `preview.html` demo now explicitly identifies its seeded, in-memory account and links to the real local app root. It cannot be mistaken for an authenticated session.
- The built-in environments use original high-resolution landscape wallpapers designed for timer-readable negative space: Event Horizon, Violet Dusk, Obsidian Flow, Ember Horizon, Monochrome Terrain, Alpine Dawn and Opal Flow, plus the custom photo option.

### Live service evidence

- The repository has a configured public Supabase URL/key; no credential values were written to documentation or output.
- The linked project reports the Spotify Edge Function as active. The Google Calendar function is not deployed.
- A Google Calendar function deploy was attempted and refused because the linked Supabase project is `INACTIVE`.
- The currently configured project hostname does not resolve from this environment, so live auth, database, RLS, Spotify, Calendar, social, and cross-device sync are **not verified**.
- Secure project configuration contains Spotify credential entries; required Google Calendar OAuth credential entries were not present. Secret values were not read or recorded.
- Linked migration inspection timed out at the database login step.

### Chrome extension verification

- An isolated Chrome launch was attempted with `npm run verify:extension -- --launch` and the installed Chrome executable.
- Modern Chrome ignored command-line unpacked-extension loading, so the verifier correctly reported that North was not installed in that temporary profile.
- Result: source and automated extension behavior are **Verified**; real Chrome installation/enforcement remains **Blocked** until a person confirms Chrome's “Load unpacked” action for `apps/extension`, after which `npm run verify:extension` must pass against that browser.

### Other implemented, not fully verified areas

- Desktop process-rule enforcement in Rust, with local persistence.
- Mobile auth/storage/shared-rule source paths.
- Social source/schema paths.

### Remaining blockers

- Reactivate the linked Supabase project, configure Google OAuth secrets securely, deploy the Calendar function, apply/inspect migrations, and run live RLS plus integration checks.
- Load the unpacked extension in Chrome and run the live verifier.
- Run the desktop Tauri/Rust build and controlled process-enforcement test.
- Native iOS/iPadOS and Android Guard enforcement needs native platform work, user-granted permissions, and any required Apple entitlements.
- Run an authenticated multi-client task/focus/Guard reconciliation test.

### Deprecated

- Board/kanban is not an active feature. Existing compatibility code and persisted fields remain only to avoid data loss; do not extend them.

## Next session starting point

1. Reactivate Supabase and repeat deployment, migration, RLS, authentication, and integration verification.
2. Manually load `apps/extension` in Chrome and rerun the live extension verifier.
3. Before deleting Board compatibility code, inventory persisted fields and approve an export/migration path.

## 2026-10-17 — Focus flip clock and theme continuity

- Replaced the static screensaver clock transition with a true split-flap digit animation: only changed digits animate, with hinged top and bottom halves and reduced-motion handling.
- Bound flip-clock accent and surfaces to the active North appearance so the clock follows the selected theme.
- Reconciled account theme loading so a cloud-selected built-in theme is written back to the local profile before bootstrap can overwrite it, then reapplied when the account profile is restored.
- Verified JSX parsing, lint, production build, and all 134 automated tests. Live multi-device theme reconciliation still needs an authenticated Supabase session and two clients.

## 2026-10-19 — Flow popup and website rule setup

- Removed the large browser-extension installation/setup card from the website Flow page; Flow now goes straight into usage and blocking controls.
- Kept the extension popup's default view focused on usage stats and usage limits, hiding the status/focus/site-management panels behind the existing secondary tools disclosure. Dashboard still opens the website's Flow tab.
- The extension now paints its background with the selected built-in North wallpaper, using the synced theme id from the account profile; the image assets are bundled in `apps/extension/wallpapers` so the popup works offline.
- Website blocking-rule creation now offers permanent, focus-session, or scheduled blocking, and requires selecting a schedule when scheduled mode is chosen.
- Verified `npm test` (141 passing), `npm run check:jsx` (35 files), JavaScript syntax checks, extension manifest JSON, and `npm run build`.
- Not verified in a live Chrome/Brave profile. Custom uploaded wallpapers remain device-local, and the screenshot's category-wide and variable per-session limit modes are not yet represented in North's enforcement model; desktop-app limits are likewise not enforced by the browser extension.

## 2026-10-19 — Focus layout, theme persistence, calendar cleanup, and Flow analytics

- Custom photo selection remains device-local and is no longer overwritten by account theme hydration; preset theme sync remains available.
- Reworked Focus Mode to fit short viewports, lock background page scrolling while open, and keep the floating Spotify transport separate from Focus controls. Spotify connection is managed in Settings.
- Focus task choices clear if their task is completed elsewhere; the task menu now expands in document flow rather than covering the phase controls.
- Calendar is now a read-only view of task due dates; task creation stays in Tasks. Google Calendar linking/events were removed from the active UI and automatic import path.
- Flow displays today and average daily usage (7-day window), daily trend, usage-share donut, and separate web/desktop breakdowns.
- Verified production build, JSX parsing, shared-module sync, and 144 automated tests. Browser visual QA and authenticated cross-device verification remain outstanding.

# 2026-10-23 — persistent limit saves and activity polish

Final packaging: desktop debug build succeeded with the final queue compatibility fix; rebuilt executable was launched. Local North website returned HTTP 200 and its React entry. Production bundle retains the pre-existing large-chunk warning. No live installed-extension propagation claim is made.

- Implemented account-scoped persistent sync queues. Session restore no longer clears pending limits. Enqueues and upload acknowledgements serialize; edits arriving during upload stay pending. Legacy username-matching queue entries remain recoverable without replaying acknowledged edits.
- Implemented storage-change notifications so Home, Flow and account preferences refresh immediately. Limit creation reports storage failure rather than silently closing as if saved.
- Extension 0.3.2 separates browsing totals/charts from desktop activity. Shared reporting excludes old internal-browser placeholders and Windows shell processes without deleting stored history.
- Interface sounds now follow the account preference in the extension as well as web/desktop. Settings retains the on/off control; timer completion sounds remain separately configurable.
- Home has a clearer focus invitation and heading hierarchy. Heatmap refreshes on daily totals/sync, supports selecting days and keyboard access, matches its displayed date-window total, and has all six correct intensity labels. Refresh notifications are coalesced.
- Verified: 72 mapping/extension/queue checks passed, 8 focused queue/tracking/realtime checks passed earlier, and final queue upgrade checks passed (4). JSX parser passed (41 files); Vite/native build succeeded before the final queue compatibility adjustment; final rebuild status is recorded below.
- Read-only live database check found one profile with permanent/scheduled rules and none with daily/session usage-limit entries. No user rules or usage were fabricated or deleted. Live signed-in cross-client propagation still needs verification in the user's installed browser extension; unit checks do not prove that round trip.

# 2026-10-24 — refresh, fast sync, milestone sounds and responsive settings

Scoped responsive verification PASSED: phone 390×844 and tablet 820×1180, all seven screens at each size. Reviewed Flow-phone and Settings-tablet screenshots. The quick audit originally printed the full 15-size matrix count despite testing only two selected viewports; fixed its report to state the actual count. Full 15-size matrix and physical-device audio playback were not tested. Debug-browser launch is hidden on Windows.

Final packaging: the web production build and desktop debug build succeeded; the rebuilt North executable was opened (process 5496). Local dev server is available at http://localhost:5174/. It binds localhost rather than the responsive script's default 127.0.0.1 URL; the final scoped responsive check uses that actual URL with an unsandboxed local debugging connection. The migration connector remains blocked; Friends is not claimed live-verified.

- Added Flow Refresh sync: flush pending edits, pull the account, apply native blocking, request extension sync, refresh usage, and show confirmed/partial/error feedback. Removed duplicate sync notices.
- Moved the hidden-site management list into Settings, keeping quick-hide actions in usage rows. Add/show changes preserve blocking and sync through the existing profile.
- Fixed sync-startup dependency: restoring an already-cached identity no longer prevents realtime listeners from attaching when the engine becomes ready. Added visible-page/online reconciliation and a 30-second fallback. Extension 0.3.3 requires Chrome 120+ for 30-second alarms; desktop polling uses the same interval plus native heartbeat/manual refresh.
- Removed all generic click/navigation sounds. Downloaded Kenney Interface Sounds CC0 confirmation_001/002 as local task/focus completion assets, preserving the original licence. Settings provides Completion sounds, volume and Test sound. Existing synthesized effects remain a decoder fallback. Focus preferences use the same account switch and save only changed preference fields.
- Social: verified the live database has no friend_action/feed/requests functions. Added an idempotent secure migration, stopped profile uploads overwriting friendships, filtered accepted friends, restored verified sessions before an action, and fixed incoming requester usernames/outgoing request persistence.
- BLOCKED: both live apply_migration attempts returned INVALID_ARGUMENT / invalid or expired requestState. The social migration was NOT applied. Manual SQL-editor execution of supabase/migrations/20261023160011_secure_social_requests.sql (or reconnecting the connector and applying it) remains necessary. No friend requests or user history were fabricated/deleted.
- Verification so far: 57 sync/extension checks passed; one verified-session social test and one bundled-audio/zero-volume/licence test passed. JSX parser passed 41 files. Responsive check initially could not reach the stopped local dev server; it was restarted for the scoped phone/tablet run. Final build/layout results follow below.

