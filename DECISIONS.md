# NORTH decisions log

Newer entries override older documentation and audit/checklist material.

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

