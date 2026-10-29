#!/usr/bin/env node
/**
 * NORTH — parse every client's JS/JSX with the toolchain that is actually
 * installed (Vite's transform pipeline), since only the web app has a build
 * step and the mobile/desktop/extension clients have no compiler of their own.
 *
 * `transformRequest` transforms a single module WITHOUT executing it, so a file
 * that imports `react-native` or `chrome.*` is still checked for syntax here —
 * which is exactly what we want and all we can honestly claim.
 *
 *   npm run check:jsx
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Vite is installed inside react-app (the only client with a build step), so
// resolve it from there instead of assuming a root-level node_modules.
const requireFromApp = createRequire(resolve(ROOT, "react-app", "package.json"));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve("vite")).href);

const FILES = [
  "react-app/src/focusly.jsx",
  "react-app/src/FocusTaskPicker.jsx",
  "react-app/src/DateField.jsx",
  "react-app/src/lib/sounds.js",
  "react-app/src/lib/desktop.js",
  "react-app/src/lib/desktop-oauth.js",
  "react-app/src/lib/usage-history.js",
  "react-app/src/entry.jsx",
  "react-app/src/preview.jsx",
  "react-app/src/lib/supabase.js",
  "react-app/src/lib/auth-events.js",
  "react-app/src/lib/sync.js",
  "react-app/src/lib/sync-map.js",
  "react-app/src/shared/blocking.js",
  "react-app/src/shared/account.js",
  "apps/mobile/App.jsx",
  "apps/mobile/MobileMain.jsx",
  "apps/mobile/MobileAppearance.jsx",
  "apps/mobile/MobileFocusClock.jsx",
  "apps/mobile/MobileNavigation.jsx",
  "apps/mobile/NorthIcon.jsx",
  "apps/mobile/MobileSettings.jsx",
  "apps/mobile/MobilePermissions.jsx",
  "apps/mobile/MobileSpotify.jsx",
  "apps/mobile/MobileCharts.jsx",
  "apps/mobile/MobileStreak.jsx",
  "apps/mobile/AuthScreen.jsx",
  "apps/mobile/lib/auth.js",
  "apps/mobile/lib/supabase.js",
  "apps/mobile/shared/blocking.js",
  "apps/mobile/shared/account.js",
  "apps/desktop/dist/app.js",
  "apps/desktop/dist/north-auth.js",
  "apps/extension/background.js",
  "apps/extension/popup.js",
  "apps/extension/blocked.js",
  "apps/extension/lib/blocking.js",
  "apps/extension/lib/account.js",
  "apps/extension/lib/goTrue.js",
  "apps/extension/lib/north-auth.js",
  "apps/extension/lib/dnr.js",
  "apps/extension/lib/account-merge.js",
  "apps/extension/lib/external.js",
  "apps/extension/lib/usage.js",
  "apps/extension/lib/block-reason.js",
  "apps/extension/lib/appearance.js",
  "packages/shared-types/blocking.js",
  "packages/shared-types/account.js",
  "scripts/sync-shared.mjs",
  "scripts/verify-rls.mjs",
  "scripts/verify-extension.mjs",
];

// Native-only modules are not installed here (see scripts/stubs/native-stub.js);
// aliasing them lets the phone's JSX be parsed without pulling in an SDK.
const stub = resolve(ROOT, "scripts", "stubs", "native-stub.js");

// Mobile-only imports that don't exist at check time: the optional
// AsyncStorage peer and supabase-js (installed under react-app, not at the
// root for the phone). Both resolve to the stub — parse-only is the point.
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
  resolve: {
    alias: {
      "react-native": stub,
      "expo-status-bar": stub,
      "@expo/vector-icons": stub,
      "@react-native-async-storage/async-storage": stub,
      "@supabase/supabase-js": stub,
      // The mobile auth glue imports the web client's sync engine directly.
      "../../react-app/src/lib/sync.js": resolve(ROOT, "react-app", "src", "lib", "sync.js"),
    },
  },
});

let failed = 0;
for (const file of FILES) {
  const url = "/" + relative(ROOT, resolve(ROOT, file)).split("\\").join("/");
  try {
    const out = await server.transformRequest(url);
    if (!out) throw new Error("no transform output");
    console.log(`OK    ${file}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${file}`);
    console.log(String(err.message || err).split("\n").slice(0, 6).join("\n"));
  }
}

server.close().catch(() => {});
if (failed) {
  console.error(`\n${failed} file(s) failed to parse`);
  process.exit(1);
}
console.log(`\nall ${FILES.length} files parsed`);
// Vite's dev server can leave a handle open in middleware mode; exit cleanly
// once the verdict is known rather than waiting on it.
process.exit(0);
