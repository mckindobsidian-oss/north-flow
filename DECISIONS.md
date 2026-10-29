# NORTH decisions log

Newer entries override older documentation and audit/checklist material.

## 2026-10-28 — Screenshot-driven native fixes, onboarding and global ranks

Use local SVG icons through the already installed react-native-svg package instead of depending on an asynchronously loaded icon font: the phone screenshots showed missing glyphs in every timer/navigation control. Keep the seven destinations and accessible labels. Remove the persistent brand/sync header; manual status is a dismissible 10-second notice. Wallpaper tiles use measured pixel dimensions and bounded image height rather than percentage/intrinsic sizing. Fixed-height day-label/dot slots prevent streak/calendar row shifts.

Tracking permissions belong in first-sign-in setup, with explicit Android approvals and Skip; settings expose one Manage setup entry plus tracking stop. The extra DNS VPN activation UI is removed because it adds VPN conflicts and cannot guarantee website enforcement; an already active filter can still be stopped. Existing native filtering code/data are preserved. Spotify uses an optional expandable WebView of the official playlist in Focus and Tasks; it gets no North session/token, accepts only Spotify navigation and offers an external fallback. Spotify controls playback availability.

Usage fetch is independent of profile reconciliation, cached per account and merged with native snapshots using the same persistent device identifier. Do not fabricate today's activity when the cloud has no rows: live inspection showed the latest upload was 2026-10-24. Extension writes must tolerate empty HTTP 201/204 bodies. Existing RLS stays owner-scoped. The additive authenticated focus_rankings RPC uses existing daily_focus aggregates, returns bounded leaders plus the caller's exact rank, and exposes no private usage/email/task data. Anonymous execution is revoked; fixed search_path is intentional for the security-definer aggregate.

## 2026-10-27 — Website-matched mobile dock and Focus composition

Supersedes the five-tab/More navigation decision below. Match the website's mobile navigation: all seven destinations remain visible in a floating dock, two rows on phones and one row from 560px. Match Focus's actual source composition rather than approximating its screenshot: task selector, flip clock in both modes, equal-width phase pills, 300px maximum circular dial with the website's radius/stroke proportions and 54px countdown, then Reset/Start/Skip/Expand icon controls. Skip uses the existing phase-change path and never records a completed Pomodoro. Both modes render the same dial/control element from the existing mounted timer. OS-native rendering and platform integrations still differ; do not claim full website feature parity from these visual changes.

## 2026-10-27 — Native mobile visual alignment

Keep React Native and the existing account/timer/enforcement architecture. Mobile reuses the website's wallpaper assets, environment labels and accent values, with neutral translucent reading surfaces and larger phone controls. Four primary tabs plus More replace seven cramped tabs; Calendar, Social and Settings remain available. Focus keeps one persistent timer across navigation and immersive mode; settings disclose inline, Spotify remains an external playlist link (not a native embedded player). Reduced-motion preference disables the flip transition. Visual alignment is not a claim of exact feature parity or authenticated-device verification.

## 2026-10-26 — Android OAuth packaging and encrypted-storage gate

Use Expo SDK-compatible native browser/crypto packages and check their availability before OAuth. Install native SHA-256 and secure randomness before creating the Supabase client; never accept a plain PKCE fallback. Build runs the focused mobile PKCE/storage tests first.

New auth writes use the app-specific north.auth.v1 encrypted namespace, read valid legacy credentials for migration, and verify encrypted chunks before publishing a manifest. Only decrypt-invalidated values count as absent; permission/IO failures remain errors. Logout removes both namespaces to prevent legacy-session resurrection. BlueStacks Pie64 still failed fresh encrypted readback after this change, so sign-in remains blocked rather than saving plaintext. Another emulator/device is required for further runtime verification; the root provider failure is not established.

## 2026-10-25 — explicit refresh and Android sideload distribution

Keep manual Refresh sync in North Flow across platforms. It must await current-device usage upload and rule reconciliation, surface failures and never report another client's connection as verified without its acknowledgment. Native Android manual sync waits on a separate network-only lock so foreground collection is not blocked on network IO. Native UI refreshes account/history without restarting an active focus timer; web/extension reload only after successful account sync.

Distribute a universal Android APK compiled for all four included ABIs, retaining the existing private signing identity and increasing versionCode. Offer an APK-only local HTTP download route with length/range/checksum support rather than relying on a Windows file link for phone transfer. Do not uninstall old builds automatically, disable phone security protections or claim every phone is supported. Device install errors require their actual installer result.

## 2026-10-24 — native Android, not a hosted web shell

Keep Expo/React Native for native phone UI and reuse the existing platform-neutral sync/account/rules modules. Add a local Expo Kotlin module for foreground UsageEvents collection, user-granted overlay enforcement and background account reconciliation. Optional accessibility inspects supported browser address bars only (hosts, never page text/paths/passwords); optional split-route DNS VPN does not inspect TLS and is not a guarantee against secure DNS/cached connections. No hidden background-app tracking or inferred overnight usage. Android package IDs are platform-specific targets; website rules are shared domains.

Use Supabase's existing provider through PKCE/system browser and `north://auth`; do not introduce another Google identity database/project. SecureStore protects JS auth persistence, Android KeyStore protects background refresh credentials, and account changes discard active rule/credential caches. Release builds use a private local PKCS12 key with a DPAPI-protected password, excluded from Git. APK distribution and Google Play policy review are separate from implementation. iOS Screen Time entitlements are not delivered by this Android work.

## 2026-10-24 — persistent account appearance and earned daily streaks

Appearance now travels as settings.appearance {id, at, photo?}, with settings.theme retained for older clients. Include appearance and theme in the profile fingerprint. Merge the newest dated appearance during pushes and pulls so routine stale profile writes do not restore an older wallpaper. Conditional profile updates compare the settings read before merging; zero-row writes remain queued to retry after concurrent changes. Custom compressed photos and adjustments travel in the existing owner-protected profile settings; this supersedes device-local photo decisions below. Violet Dusk is the default; explicit existing selections remain intact. All clients must update to consume the photo document and conditional writer.

Daily streak eligibility requires both a naturally completed full focus session and a task completed on that local calendar date. Store additive per-day flags in account settings, merge flags across devices, derive current/best streak and earned milestones without fabricating historic task completion dates. Milestones: 1, 3, 7, 14, 30, 100. Sounds remain opt-in for these meaningful events, with separate task/focus/break/streak/achievement cues.

Hidden items use the existing hiddenUsageSites list, with app:<normalized executable> for apps and plain hostnames for websites. This only changes reports; enforcement continues to count original usage.

## 2026-10-23 — account registration, observed usage and shared analytics

**Decision:** probe the authenticated user ID directly during Google login, before attaching sync. Preserve existing profiles as registered; future profile rows start onboarding_complete=false and successful North registration completes that marker. Coalesce simultaneous auth-event and boot adoption.

**Decision:** never publish a profile merely because the extension pulled it. Distinguish remote cache writes from UI edits, reject pulls that race a local edit, and retain changes queued during an upload. Account activity uses cumulative per-device snapshots, with one shared JS merger for web, extension and future mobile consumers.

**Decision:** browser timers belong to the current browser session and discard unobserved gaps longer than 90 seconds. Revalidate foreground/idle state during periodic sampling. Daily history is preserved; hourly data is collected prospectively in the existing usage_records table. Today/Yesterday use hourly views, custom date ranges daily views; pie charts use filled SVG slices.

**Decision:** app session limits use the configured foreground allowance while that process remains open; browser session limits continue to ask for an allowance per visit. Creating a replacement limit changes only its selected kind/target, retaining all other app and website limits. Daily budgets use cached account usage from other collectors, with eventual synchronization rather than atomic online allocation.

**Decision:** interface sounds are opt-in in Settings, separate from Focus completion sounds. Use generated Web Audio and reduced-motion-aware CSS instead of new asset or animation dependencies.

## 2026-10-23 — foreground desktop tracking and tray synchronization

**Decision:** Windows records the foreground executable at one-second resolution, excluding browsers, protected processes and OS idle time after 60 seconds. Skip samples spanning sleep. Persist every ten samples and on normal tray Quit. App rules match exact executable names (case-insensitive, optional .exe suffix).

**Decision:** keep the native collector/enforcer running when the window hides to the tray. A native ten-second heartbeat also triggers the existing authenticated sync bridge, avoiding dependence only on hidden-window JavaScript timers. Upload activity through the existing device-scoped usage_records rows; expose today's account-owned desktop activity in the extension with an owner/day-scoped cache.

**Consequence:** the extension reports desktop usage but only the native client closes desktop processes. Normal Quit stops tracking. Rule definitions and usage snapshots synchronize; a single atomic cross-device allowance remains separate unfinished work.

## 2026-10-22 — foreground-only browser usage

**Decision:** count only the selected HTTP(S) tab in the focused browser window while the OS is active. Ignore background audio even if a legacy preference enabled it; stop tracking on idle/lock and resume on activity. The idle threshold is 60 seconds.

**Consequence:** existing historical records are retained; the new policy applies after extension reload. The extension requires Chrome's idle permission.

## 2026-10-21 — readable surfaces, unified Flow and the full desktop frontend

**Decision:** readability takes priority over the earlier near-transparent white-glass recipe. Retain wallpapers and theme accents, but give reading surfaces a stable dark/light backing. Flow presents combined website/app activity and one limits list; target kind still determines the correct native enforcer. Its summary cards are Today (date), Current day (duration), Average daily (selected inclusive range), and Days tracked (unique active dates in that range). No Selected total card.

**Decision:** desktop bundles the same React frontend locally and uses its existing Supabase account/sync layer. Rust retains foreground usage collection, process enforcement, offline files and tray features. It does not load a hosted website. Focus stays mounted across in-app navigation; completion sound and volume use the existing profile preferences.

**Consequence:** the extension displays app and website rules together, while only browser website usage is measured there. Current-day usage uploads alongside completed days. Existing usage-record uniqueness still cannot safely combine overlapping totals from multiple collectors; that remains an explicit reliability item until device/source reconciliation is implemented and tested.

## 2026-10-19 — extension account follows the signed-in North website

**Decision:** the extension has one Connect to North action, not separate email, Google, or local-name login. After the explicit click, a short-lived nonce binds the North page to the requesting extension; the extension validates the transferred Supabase session with `/user` before saving it.

**Consequence:** the website remains the authentication UI and Google configuration stays unchanged. The same Supabase refresh session is stored by the extension for background sync; verify behavior in the target browser and after account switches.

## 2026-10-19 — honest daily Flow charts and optional Spotify embed

**Decision:** Flow charts use the collected daily usage rows, with desktop and browser activity separated; do not imply hourly/session precision that the current store does not collect. Spotify is an optional official embed configured by a share URL, not a required account integration.

**Consequence:** the dashboard remains useful and accurate, and the Focus page does not show an empty Spotify window or obscure the timer before setup.

## 2026-10-19 — consistent white glass; clock belongs to Focus

**Decision:** Use the same translucent white surface recipe for every preset and custom wallpaper, while retaining wallpaper/accent variation and honoring reduced-transparency preferences. Treat the flip clock as part of immersive Focus rather than exposing a second screensaver mode.

**Consequence:** Focus exits through a visible close icon (Escape remains available); Focus preferences use an icon-only control, and custom-photo adjustment controls stay collapsed until its gear is selected. The UI remains glassy by default without forcing photo brightness or overlay adjustments.

## 2026-10-19 — one Flow limit creation path, local enforcers stay distinct

**Decision:** Flow creates permanent, scheduled, daily, or per-visit limits from observed websites and desktop apps in one dialog. Website rules are enforced by the extension; desktop app rules by North Desktop. The extension popup focuses on usage, synced limits, and account sync rather than duplicating the creation UI.

**Consequence:** The session allowance is currently offered only for websites because the extension implements per-visit timing while the desktop app does not. The prior rule and schedule editors remain available under Advanced controls for existing users and focused rule administration. Desktop enforcement still needs a native Windows build and behavioral test before it is considered complete.

## 2026-10-19 — discovered targets are limit entry points; short visits stay visible

**Decision:** Flow exposes every observed website/app in its reporting window with second-level durations and lets a person start a limit directly from that target. The extension's block page offers a validated one-minute temporary unblock and a direct Flow deep link.

**Consequence:** browser usage remains active-tab based unless audible-background tracking is enabled; Flow history is limited to its seven-day window, and Dashboard uses the most recently contacted allow-listed North origin (local development or deployed site).

## 2026-10-19 — website and desktop usage remain separate streams

**Decision:** website minutes are collected by the browser extension; Windows desktop minutes are collected by the Tauri foreground-app sampler. Both sync daily aggregates to `usage_records`, where `kind` distinguishes `website` from `app`. Flow displays separate graphs and totals; browser processes are excluded from desktop app totals to avoid overlap.

**Consequence:** desktop data records executable names and active time only, requires an account sign-in for account-scoped tracking/sync, excludes sessions after 60 seconds of OS inactivity, and is Windows-only for now. Audible browser tabs are a user-controlled extension option.

## 2026-10-19 — browser usage caps belong to shared Flow rules

**Decision:** daily website limits are part of the existing shared blocking model; the extension enforces them using its browser-local UTC-day usage. The popup presents compact Usage Stats and Usage Limits tabs in North's visual system, and its Dashboard action opens Flow.

**Consequence:** report only browser-observed website usage, never imply desktop-app tracking from the extension. A cap reached during an open page takes effect on the next navigation/request; limits are not a substitute for OS-level enforcement.

## 2026-10-19 — theme intent survives interrupted sync

**Decision:** persist a pending theme choice locally until the account confirms the update, and prioritize that choice during reload hydration.

**Consequence:** reloads and return visits recover the latest selection even if the previous page closed before its cloud write completed.

## 2026-10-19 — theme changes sync before extension refresh

**Decision:** when a signed-in user changes appearance, persist the selected theme to the account profile immediately before asking the extension to sync. The extension stores that theme ID and uses its corresponding palette; it does not duplicate the multi-megabyte wallpaper files.

**Consequence:** reopening or returning to North cannot race an older cloud theme against the new selection, and the compact popup follows the same theme accent. Account theme sync requires the web app and extension to use the same signed-in account.

## 2026-10-19 — wallpaper contrast and durable browser usage

**Decision:** derive ink contrast from the actual vivid wallpaper luminance (the new dark-toned scenes use light ink), while retaining translucent tinted glass. The extension's active-tab clock is persisted so MV3 worker suspension and browser-window focus changes do not stop or invent usage time.

**Consequence:** daily extension usage stays device-local for today, is exposed to the exact allow-listed NORTH origins as domain/time aggregates only, and syncs completed days idempotently for the authenticated account. Native application usage remains the desktop client's responsibility; a browser extension cannot inspect other processes.

## 2026-10-19 — vivid glass themes and original wallpapers

**Decision:** replace the overly pale Alpine Dawn and Opal Flow options with three vivid original landscape wallpapers (Aurora Lake, Prism Horizon, Ember Tide). Make Aurora Lake the default and retain the older dark themes. Use readable translucent light glass, stronger specular edges and layered shadows/hover lift for depth; keep contrast and reduced-motion/transparency fallbacks.

**Consequence:** existing dark environments remain selectable. The imagery is original and uses Apple's public material guidance as inspiration, not copied Apple artwork.

## 2026-10-19 — extension Google sign-in

**Decision:** use Supabase OAuth with PKCE and `chrome.identity.launchWebAuthFlow`; never place a Google client secret in the extension.

**Consequence:** users must enable Google in Supabase and allow-list the extension's exact `chromiumapp.org/supabase` callback. OAuth exchange and callback validation are covered by unit tests; live provider sign-in still requires project configuration and browser verification.

## 2026-10-19 — extension account login verifies email; limits persist as account rules

**Decision:** the extension's email login is an existing-account email OTP flow, not password-only auth. Website limits remain in the shared account blocking document until a person removes them; the daily allowance counter is a separate UTC-day value that rolls over.

**Consequence:** Supabase must send the OTP token in its email template, and OAuth/project URLs still require dashboard setup. This is email verification as the sign-in method, not a second factor after password; whole-account mandatory MFA remains a separate Supabase/client configuration task.

## 2026-10-19 — North Flow is the customer-facing name

**Decision:** name the website tab, blocking screen, extension, and block-page actions **Flow / North Flow**. Keep the shared blocking model and enforcement behavior unchanged; “Guard” remains only in historical notes or generic security language.

**Consequence:** web and extension surfaces use “Flow” consistently, while the account schema, rule engine, and enforcement stay the same.

## 2026-10-19 — Liquid Glass across the web app

**Decision:** follow the supplied translucent media-control reference: use stronger, edged glass for floating controls, navigation and sheets; keep dense work surfaces crisp and legible rather than blurring every card. Keep the material theme-aware and preserve solid surfaces for reduced transparency, increased contrast, and forced-colors preferences.

**Consequence:** use CSS backdrop filtering as progressive enhancement; page content and interactions must remain clear when filtering is unavailable or disabled.

## 2026-10-17 — contextual controls and restrained materials

Focus owns timer preferences and Spotify; Calendar owns Calendar integration management. General Settings retains account, appearance and global preferences. Reuse existing account/task/session records. Glass belongs to floating controls, not every content container.

## 2026-10-17 — screensaver is presentation, not another session

Render immersive Focus in a portal so layout transforms cannot trap its fixed position. Screensaver hides secondary controls while keeping the same countdown and task. Keep a static wallpaper fallback; no ambient video or autoplay audio is needed for this implementation. The existing Focus-tab unmount lifecycle remains separate unresolved work.

## 2026-10-17 — integration failure is not disconnection or connection

Preserve cached state on failed probes, require a successful backend response before clearing a grant locally, and never turn a missing function or upstream failure into connected status. Deployment existence is not proof of OAuth/playback/import functionality.

## 2026-10-17 — persist explicit appearance choices

Explicit theme selection updates the profile through the existing storage/sync boundary, and local navigation waits for pending appearance writes. Custom wallpaper bytes remain device-local. This does not certify the existing whole-document sync conflict strategy; versioned reconciliation and multi-device tests remain required.

## 2026-10-16 — product source of truth

**Decision:** `NORTH_MASTER_PLAN.md`, `ARCHITECTURE.md`, this log, `PROGRESS.md`, and `ROADMAP.md` are the durable project record.

**Why:** the repository contains implementation and documentation from several stages. Future work must resume from inspected evidence rather than chat history or stale claims.

## 2026-10-16 — Focus first

**Decision:** Focus/Pomodoro is NORTH's primary experience. Tasks and every other surface must reinforce the focus loop.

**Consequence:** avoid adding planning/productivity breadth that obscures the timer and its truthful results.

## 2026-10-16 — North Guard is one model, many local enforcers

**Decision:** rules, schedules, limits, and focus-linked blocking form one shared cloud/account model. Enforcement remains a local responsibility of the client platform.

**Consequence:** web configures/reports but cannot block; the extension can block browser sites; desktop can terminate matching processes but cannot prevent launch; mobile enforcement waits for real native permissions and entitlements. Every UI must communicate that boundary.

## 2026-10-16 — Board is deprecated

**Decision:** Board/kanban is no longer current product direction.

**Consequence:** no new Board work. Existing code/schema fields are retained only to avoid accidental data loss until a migration/export/removal plan is approved and verified.

## 2026-10-16 — real integrations only

**Decision:** authentication, sync, Google Calendar, Spotify, social, and blocking must be backed by real integration/data and must not appear functional without verification.

**Consequence:** disabled, unavailable, setup-required, and failed states are product states—not gaps to hide. Integration credentials remain in secure environment/platform secret configuration only.

## 2026-10-16 — design direction

**Decision:** NORTH remains minimal, Apple-inspired, atmospheric, and focused.

**Consequence:** prefer system semantics, readable hierarchy, subtle material and motion, accessibility support, and fewer surfaces. Reject generic SaaS dashboards, nested cards, noisy metrics, and decorative UI unrelated to focus.

## 2026-10-16 — Supabase auth events are the session authority

**Decision:** the live Supabase auth-state subscription is the authoritative source for web session transitions. Password and OAuth paths must converge on it instead of independently adopting the same account.

**Consequence:** sign-in, sign-out, token refresh, and user updates keep local identity, sync attachment, and the rendered account aligned. Auth callbacks remain synchronous; profile/network work is queued outside them.

## 2026-10-16 — Focus Mode is one timer and one Guard session

**Decision:** immersive Focus Mode is a presentation of the active Pomodoro session, not a second timer or blocking lifecycle.

**Consequence:** entering Focus Mode starts the timer when necessary and publishes one shared focus window. Leaving the immersive view does not end that session; pause, reset, completion, or expiry own the session lifecycle.

## 2026-10-16 — cached identity is not authorization

**Decision:** preserve the last Supabase-verified account identity in the device session pointer so local-first boot does not mislabel a signed-in person when the service is temporarily unreachable.

**Consequence:** this improves truthful account presentation only. Edge Functions, RLS, and all protected writes still require the active Supabase session and remain unavailable if that session cannot be restored.

## 2026-10-17 — split-flap clock is the Focus screensaver clock

**Decision:** Focus screensaver time uses a two-stage split-flap animation modeled on physical flip clocks: unchanged digits remain still, while changed digits rotate the outgoing top half and incoming bottom half.

**Consequence:** the animation is legible and restrained, respects reduced-motion preferences, and keeps the clock lightweight without a new dependency.

## 2026-10-17 — account theme wins during profile hydration

**Decision:** when Supabase supplies a valid account theme, it is the source of truth during bootstrap and is reconciled into the local profile before the rest of the app hydrates.

**Consequence:** reopening Settings or switching tabs no longer silently returns a signed-in user to the default theme. Custom wallpaper pixels remain device-local unless a future storage-backed theme asset is added.

## 2026-10-19 — a custom wallpaper is a device-local override

**Decision:** account hydration may sync named theme presets, but it must never replace a custom wallpaper already selected on that device.

**Consequence:** custom photo selection survives reload and account re-entry without uploading the image or confusing it with a portable preset id.

## 2026-10-23 — pending edits are account-owned, not session-owned

Persist sync queues by Supabase user ID and retain them when a session is restored. Serialize acknowledgement with enqueue operations so a finishing upload cannot erase a newer edit. Read only matching username keys from legacy queues; retain their source as a recovery copy. Local persistence errors must not be reported as successful limit creation.

The extension's browsing view excludes desktop app activity, which remains separately labelled. Shared reports hide historical browser-internal placeholders without destructively modifying history. Interface sounds are opt-in via the existing account preference; motion respects reduced-motion settings and heatmap day details do not rely on colour alone.

## 2026-10-24 — deliberate feedback and server-owned social relationships

Sounds are opt-in milestone feedback only: completed tasks and focus/break completions, never arbitrary clicks or navigation. Bundle the small CC0 samples locally, retain licence/source metadata, and use Web Audio with a gesture-primed context and synthesized decoder fallback.

Friendships are created/accepted/removed exclusively by ownership-checked authenticated RPCs. Ordinary profile sync may not forge accepted edges or prune pending requests. Friend actions verify the actual Supabase session, never a cached display identity. Recipient request reads expose usernames through a scoped RPC, not raw UUIDs used as usernames.

Prefer realtime/direct sync, backed by a 30-second online polling interval. Manual Refresh must distinguish account success from extension confirmation and retain queued edits on failure; sleeping/offline clients cannot be promised a wall-clock delivery guarantee.

