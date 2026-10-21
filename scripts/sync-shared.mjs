#!/usr/bin/env node
/**
 * NORTH — vendor the canonical shared modules into each client.
 *
 * WHY A COPY INSTEAD OF AN IMPORT
 * The three JS clients cannot import `packages/shared-types/` directly:
 *  - a Chrome MV3 extension may only load files inside its own package;
 *  - Metro (Expo) needs extra watch-folders config to reach outside the app;
 *  - Vite refuses to serve files outside its project root without fs.allow.
 * Rather than three bespoke build configurations (each able to break
 * independently), the canonical file is copied verbatim into each client and
 * marked GENERATED. `--check` fails if a copy drifts, and the test suite runs
 * exactly that check, so the copies can never silently diverge.
 *
 *   node scripts/sync-shared.mjs           # write the copies
 *   node scripts/sync-shared.mjs --check   # fail if any copy is stale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Canonical sources, in dependency order. */
export const CANONICAL = ["blocking.js", "account.js"];

/** Where each client keeps its generated copy. */
export const TARGETS = [
  "react-app/src/shared",
  "apps/extension/lib",
  "apps/mobile/shared",
];

const SOURCE_DIR = join(ROOT, "packages", "shared-types");
const GENERATED_NOTE = (name) =>
  `// ─────────────────────────────────────────────────────────────────────────\n` +
  `// GENERATED FILE — DO NOT EDIT.\n` +
  `// Source of truth: packages/shared-types/${name}\n` +
  `// Regenerate with: npm run sync:shared\n` +
  `// ─────────────────────────────────────────────────────────────────────────\n`;

export const canonicalPath = (name) => join(SOURCE_DIR, name);

/** The exact text a client copy must contain. */
export function render(name) {
  return GENERATED_NOTE(name) + readFileSync(canonicalPath(name), "utf8");
}

/** Copy (or verify) one file; returns null when up to date, else a message. */
export function writeOne(name, dir, { check }) {
  const dest = join(ROOT, dir, name);
  const want = render(name);
  const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
  if (have === want) return null;
  if (check) {
    return have === null
      ? `missing: ${dir}/${name}`
      : `stale:   ${dir}/${name}`;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, want);
  return have === null ? `created: ${dir}/${name}` : `updated: ${dir}/${name}`;
}

export function runSync({ check = false } = {}) {
  const messages = [];
  for (const dir of TARGETS) {
    for (const name of CANONICAL) {
      const msg = writeOne(name, dir, { check });
      if (msg) messages.push(msg);
    }
  }
  // A copy whose canonical source was deleted must not be left behind.
  // Directories may also hold client-OWNED modules (e.g. the extension's
  // lib/north-auth.js in apps/extension/lib) — only flag files that are NOT
  // marked as generated, i.e. files pretending to be vendored copies.
  for (const dir of TARGETS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs)) {
      if (!file.endsWith(".js") || CANONICAL.includes(file)) continue;
      const raw = readFileSync(join(abs, file), "utf8");
      if (!raw.startsWith("// ─")) continue; // client-owned module, not a copy
      messages.push(`unknown: ${dir}/${file} (not a canonical shared module)`);
    }
  }
  return messages;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const messages = runSync({ check });
  if (!messages.length) {
    console.log(check ? "shared modules: all copies in sync" : "shared modules: nothing to do");
    process.exit(0);
  }
  for (const m of messages) console.log(m);
  if (check) {
    console.error("\nShared copies are out of date — run: npm run sync:shared");
    process.exit(1);
  }
  console.log("shared modules: synced");
}
