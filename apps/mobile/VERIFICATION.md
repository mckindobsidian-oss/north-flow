# Android verification — 2026-10-24

## Screenshot fixes — 2026-10-28, version 0.2.5 (7)

All 17 user screenshots inspected. Implemented SVG icons, compact measured wallpaper tiles, greeting/header cleanup, task editor disclosure and icon actions, stable streak/calendar day slots, smoother native digit overlay, timer restoration recovery, collapsed hidden usage, post-login permission setup and expandable Spotify embeds in Focus/Tasks. Brighter wallpaper contrast strengthened. Usage refresh/cache and local/native deduplication use the account and stable collector id; stale cloud ranges are reported honestly. Global leaderboard RPC deployed and server-checked; usage table had no uploaded day newer than 2026-10-24 during investigation.

13 mobile modules parsed; eight targeted REST/queue/Realtime/usage tests and five existing mobile crypto checks passed. Offline dependency resolution failed for the newly installed WebView; retry with Maven downloads enabled built successfully (19m21s). APK signature, alignment, four ABIs, backup/debug and permission checks passed; RNCWebViewPackage registered. SHA-256 030DF3E054706708CCF352020D0A2BC73720C073A3165B8DC79E15FEDF2AFB3E. Parent North-0.2.5.apk is the new release.

No connected adb device: visual phone recheck, actual playback, OS permission grants, fresh foreground tracking and authenticated multi-device limit enforcement remain unverified. No claim of Google Play certification or resolution of the older emulator keystore issue. No North tokens are supplied to the Spotify WebView. DNS activation removed from normal settings; stop remains available for an existing filter.

## Website Focus/dock follow-up — 2026-10-27, version 0.2.4 (6)

Compared against current website Focus and north-mobile-nav source. Native dock now exposes all seven destinations in 4+3 phone rows / one tablet row; both Focus modes share flip clock, equal-width phase pills, matching dial geometry/countdown typography, and Reset/Start/Skip/Expand controls. Skip uses phase change without completion credit.

Three changed JSX files parsed, five existing mobile auth/crypto checks passed, release build succeeded in 5m33s. APK signature, alignment, ABI and permission/backup checks passed. SHA-256 CFF50B7EC3F20DF6D664EB7E1A017C596CE5E878E40450CC94E41CC7435B7F00. Available as parent North-0.2.4.apk and North-Android.apk. Visual/runtime recheck blocked: Pie64 was not running, endpoint refused connection. No claim of screen-by-screen physical-device visual validation or resolution of the earlier encrypted-storage issue.

## UI alignment release — 2026-10-27, version 0.2.3 (5)

Native UI updated to the website/desktop wallpaper, accent and glass language; circular focus timer and immersive animated clock, clearer navigation and readable controls. Six changed mobile JSX files parsed; five existing mobile auth/crypto checks passed. Release build, APK v2 signature, 16 KB alignment, four ABIs and permission/backup checks passed. SHA-256 C4DD031ADEECADBFE872F55BB26427DD986B080C04712EE3D1356555A3D9054F; 77,895,991 bytes. Copied to parent North/North-Android.apk.

Runtime visual review remains pending: existing local emulator endpoint refused connection. No authenticated phone, screen-by-screen visual parity, native Spotify embedding or successful OAuth roundtrip is claimed. The previous encrypted-storage emulator failure remains separate. No authentication or blocking permissions were weakened for this UI release.

## Current result — 2026-10-26, version 0.2.2 (4)

White-screen crash reproduced as missing ExpoWebBrowser after Google tap. SDK-compatible native dependencies, registration guard and native S256 PKCE support added. Five focused tests passed; universal APK build, signature, alignment, ABI and permission checks passed. SHA-256: 0EF46E65DB0C92FF5B617EA078241824D74253F42F03E12E9AA041D6A8CC34FC; 77,886,655 bytes.

Updated Pie64 Android 9 via adb install -r, no uninstall/data clear. Native login renders and survives a Google-button test without the previous crash. However encrypted-storage readback fails even in the fresh north.auth.v1 namespace; UI explicitly blocks sign-in. No account credentials entered, no successful OAuth/session/sync claim. Need another Android instance or device to verify secure sign-in and authenticated tracking/blocking. Physical Oppo installation remains unresolved. Older first-launch results below are historical.

## Installed and launched — 2026-10-26

The user's Pie64 device is now running and accessible at localhost adb port 5556 (5555 was offline). Android reports version 9 and compatible x86_64/x86/arm64-v8a/armeabi-v7a/armeabi ABIs.

**Passed:** existing universal APK streamed installation returned `Success`; package manager resolved com.north.mobile; `am start -W -n com.north.mobile/.MainActivity` returned Status ok; process remained alive and resumed in the foreground. A fresh emulator screenshot, captured only after checking North was resumed, showed the complete native login screen (`.tmp/north-android-launch.png`). Its process-scoped AndroidRuntime/ReactNativeJS error log was empty apart from the log header.

**Still pending:** manual user login, real OAuth return/session refresh, signed-in feature screens, OS monitoring/overlay/accessibility/VPN permission flows, actual tracking and blocking, sound playback, offline reconciliation and multi-device sync. No credentials or user account tokens were entered, copied or injected. No runtime claim beyond installation and the logged-out first launch is made. BlueStacks installation does not reproduce or dismiss the physical Oppo's Play Protect warning. Older blocked setup notes below are historical.

## BlueStacks continuation — 2026-10-26

User explicitly reauthorized controlling BlueStacks only. Installer Authenticode recheck: Valid, publisher Now.gg, INC. Windows exposes an installed BlueStacks Store entry, and its Store window opened from `C:/Program Files (x86)/BlueStacks X/BlueStacks X.exe`. This does not establish that an Android App Player is installed or booted. adb still lists no connected Android device.

Computer Use window capture failed with `FrameArrived timed out: timed out waiting on channel`; refreshed window selection and one activation/capture retry failed with `window capture timed out: timed out waiting on channel`. UI automation stopped. No setup buttons clicked, no Windows security/privacy settings changed, no reboot triggered, no credentials entered. North APK installation and runtime testing remain unverified; user must open/install App Player manually or provide a working Android device before those tests can proceed.

## Emulator retry — 2026-10-25

- Existing Google emulator 37.2.12 was found installed; its acceleration check reports WHPX usable. Android 15 Google APIs image retry timed out after 180 seconds; partial file retained.
- Downloaded the smaller official Android 8/API 26 x86 image with resumable retries: 350,195,807 bytes, SHA-1 matched Google's published `e613d6e0da668e30daf547f3c6627a6352846f90`. Extracted under the local SDK and created workspace-scoped `North_API26` AVD. No host security/virtualization settings changed.
- Boot attempts with software graphics, including Vulkan disabled, did not produce an adb-connected Android device. Logs are under `.tmp/north-emulator*.log`; graphics startup is the last useful diagnostic, not a proven root cause. No APK installation or runtime test occurred.
- Genymotion current documentation requires an account and lists Windows 11; BlueStacks 5 was selected as the Windows 10-compatible fallback. Official lightweight installer saved as `.tmp/android-tools/BlueStacksInstaller.exe` (953,864 bytes), Authenticode status Valid, publisher Now.gg, INC. It has NOT been run/installed. Computer Use action-time confirmation required before running newly acquired installer; waiting for the user's approval. No real account credentials were entered and no app/user data was uploaded.

## Update — 2026-10-25

Version 0.2.1 (3): `artifacts/North-Android-universal.apk`, 77,884,255 bytes, Android 8+/target 35. All four ABIs compiled: arm64-v8a, armeabi-v7a, x86, x86_64. Release build, APK v2 signature, 16 KB ZIP alignment, ABI, backup/debug and permission checks passed. SHA-256: `642988E80510D0CA607876201185DAB9D8D30EF6ED287B73B7AEDF8947434C8A`.

62 targeted sync/desktop/extension/streak tests, 43-file parse check, web production and Windows desktop builds passed. APK-only HTTP download headers/ranges/404 isolation passed. Native manual sync now waits for an in-flight background operation; Flow-only refresh and native streak redesign are included.

**Installation/launch remains unverified.** No phone connected to adb. Google's emulator download timed out after 360 seconds with 11 MB of 459 MB received; the independent range retry failed too. No emulator boot or runtime feature test occurred. Oppo Reno 8 5G user reported “App not installed” for the earlier artifact, but no installer error code was available; cause is not established. Use the phone download page or `scripts/install-android.ps1` with an authorized USB device to get an exact result. Older verification below describes 0.2.0.

## Passed

- Shared test suite: 177 tests, no failures (rules, account mapping, queues, usage merging, appearance, social auth, streak concurrency).
- Expo Android prebuild: native NorthDevice autolinking and Android SDK 35 configuration.
- Standalone Metro Android export: generated `.build/export/metadata.json` and bundled assets.
- Source inspection: owner-scoped queues/counters, HTTPS-only native API, KeyStore encryption, explicit OS permission grants, backup disabled, no service-role credentials.
- Web production and Windows desktop debug builds passed. Browser preview confirmed readable achievement cards, working milestone detail disclosure, a themed hidden-item dropdown, visible Refresh and removal of the browsing-summary panel.
- Android SDK/platform-tools check: no physical device or emulator connected (`adb devices` empty).
- Native Kotlin compilation, Windows C++ linking and Android release lint passed. Signed release APK assembled successfully.
- Final artifact: `artifacts/North-Android-arm64-v8a.apk`, 40,086,436 bytes; package `com.north.mobile`, version 0.2.0 (2), Android 8+/API 26, ARM64 only, target API 35.
- APK Signature Scheme v2, 16 KB ZIP alignment, ARM64 packaging, backup/debug configuration and absence of microphone/storage/all-apps permissions passed `scripts/verify-android.ps1`.
- SHA-256: `EF2D3ECBB0D8A407A12F5C9D0F7B24A4F9A32407B9098EBECE084DFC241BC6AA`.

## Physical-device scenarios not yet verified

- Physical Android Google login/deep-link return and session refresh.
- Foreground tracking accuracy across app switching, screen lock, battery restrictions and multi-window.
- Overlay blocking, all four rule modes, supported browser address bars and optional DNS VPN on a real device.
- Offline/reconnect upload, sign-out/account isolation and two-device live quota reconciliation.
- Phone/tablet visual layout, audio playback and native accessibility with a device screen reader.

These scenarios require a phone/emulator; source checks do not replace them. The DNS filter can be bypassed by secure DNS/cached connections and cannot coexist with another VPN. Shared quotas reconcile every 30 seconds when connected and can overshoot while devices are offline. Android may stop services after force-stop or manufacturer battery restrictions; reopening/re-enabling monitoring may be required.

## Explicit mobile scope limits

- Spotify opens the default playlist in Spotify/the browser; a native floating Spotify player is not implemented.
- Existing custom account wallpapers display on mobile; upload/adjustment controls remain on the web/desktop client.
- A suspended focus countdown catches up and records completion when the app resumes. An app-terminated timer-completion alarm is not implemented.
- Android package IDs and Windows executables are different app targets; a Windows-only app rule cannot identify a different Android package automatically.
- No iOS Screen Time enforcement, store approval or production security certification is claimed.
