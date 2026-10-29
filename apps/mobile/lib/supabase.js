/**
 * NORTH mobile — the Supabase client.
 *
 * Same public project configuration as every other client (URL + anon key —
 * both public by design; RLS is the security boundary, not the key). Values
 * come from app config, never hardcoded secrets, and a missing configuration
 * must not crash the app: accounts are simply unavailable and the UI says so
 * (the same stance as react-app/src/lib/supabase.js).
 *
 * SESSION PERSISTENCE
 * supabase-js accepts a storage adapter; on web that is localStorage, on the
 * phone it is AsyncStorage. AsyncStorage is deliberately an OPTIONAL peer
 * dependency — it is not in package.json yet, and importing a missing native
 * module crashes the Metro bundle for everyone who has not run
 * `npx expo install @react-native-async-storage/async-storage`. So: try the
 * import, and fall back to an in-memory adapter (sessions last one app run —
 * honest, functional, and the UI reports persistence as unavailable). Once
 * the package is installed, persistence is automatic with zero code change.
 */

import 'react-native-url-polyfill/auto';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { installPkceCrypto } from './pkce-crypto.js';
import { secureSession } from './secure-session.js';
export const securePkceReady = Boolean(requireOptionalNativeModule('ExpoCrypto')) &&
  installPkceCrypto(globalThis, require('expo-crypto'));
let AsyncStorage = null;
try {
  // Optional at build time; resolved by Metro when the package is installed.
  // eslint-disable-next-line import/no-unresolved
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {
  AsyncStorage = null; // not installed yet → memory adapter below
}

const memoryAdapter = () => {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, v); },
    removeItem: async (k) => { m.delete(k); },
  };
};

const storage = AsyncStorage
  ? {
      getItem: (k) => AsyncStorage.getItem(k),
      setItem: (k, v) => AsyncStorage.setItem(k, v),
      removeItem: (k) => AsyncStorage.removeItem(k),
    }
  : memoryAdapter();

/** True when sessions survive an app restart (AsyncStorage present). */
export const sessionsPersist = Boolean(AsyncStorage);

// Expo exposes app config extras and environment-like constants without any
// native module; the two public values live in app.json → expo.extra, which
// `app.config.js`-free setups populate via eas/env or a local gitignored
// override. Placeholders behave exactly like on web: unconfigured, not fatal.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl || null;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Constants.expoConfig?.extra?.supabaseAnonKey || null;

const placeholder = (v) => !v || /^your_/i.test(String(v).trim());

export const supabaseConfigured = !placeholder(url) && !placeholder(anonKey);

let client = null;
if (supabaseConfigured) {
  // Supabase is installed in react-app; Metro resolves it from the monorepo
  // root's node_modules for the phone build. Same library, same protocol.
  // eslint-disable-next-line import/no-unresolved
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(url, anonKey, {
    auth: {
      storage: secureSession,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // sessions arrive via deep link, not a URL bar
    },
  });
} else {
  console.warn(
    "[north] Supabase is not configured — accounts are unavailable on this device. " +
      "Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see apps/mobile/README.md)."
  );
}

export const supabase = client;
