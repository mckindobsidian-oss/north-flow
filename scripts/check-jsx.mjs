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
  "react-app/src/entry.jsx",
  "react-app/src/preview.jsx",
  "react-app/src/lib/supabase.js",
  "react-app/src/lib/sync.js",
  "react-app/src/lib/sync-map.js",
  "react-app/src/shared/blocking.js",
  "react-app/src/shared/account.js",
  "apps/mobile/App.jsx",
  "apps/mobile/shared/blocking.js",
  "apps/mobile/shared/account.js",
  "apps/desktop/dist/app.js",
  "apps/extension/background.js",
  "apps/extension/popup.js",
  "apps/extension/lib/blocking.js",
  "packages/shared-types/blocking.js",
  "packages/shared-types/account.js",
  "scripts/sync-shared.mjs",
  "scripts/verify-rls.mjs",
];

// Native-only modules are not installed here (see scripts/stubs/native-stub.js);
// aliasing them lets the phone's JSX be parsed without pulling in an SDK.
const stub = resolve(ROOT, "scripts", "stubs", "native-stub.js");

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
