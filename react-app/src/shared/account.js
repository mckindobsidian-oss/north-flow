// ─────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Source of truth: packages/shared-types/account.js
// Regenerate with: npm run sync:shared
// ─────────────────────────────────────────────────────────────────────────
/**
 * NORTH — canonical account mapping (shared).
 *
 * THE BUG THIS FILE EXISTS TO KILL
 * Supabase hands back a User shaped like { id, email, user_metadata:{ name } }.
 * The NORTH app works with a user shaped like { un, name, tasks, apps, … }.
 * Before this module, the auth screen passed the Supabase object straight into
 * the app, so every screen looked up `u:undefined` and the header crashed
 * reading `(user.name || user.un)[0]`. One mapper, used by every client that
 * signs in, means there is exactly one definition of "who is this?" — and the
 * username (`un`) is derived deterministically, so the SAME person gets the
 * SAME key on every device, which is what makes cross-device sync possible.
 *
 * Pure module: no network, no storage, no DOM. The caller loads/saves the
 * profile through its own storage boundary (web: `S.*`).
 */
import { defaultBlocking, normalizeState } from "./blocking.js";

/** Storage key for a user's profile record. Kept identical across clients. */
export const PROFILE_KEY = (un) => `u:${un}`;

/**
 * Appearance ids, shared so every client resolves the account preference
 * identically. North Glass is NOT an appearance — it is the design language
 * every environment renders through.
 *
 * The registry holds the five BUILT-IN wallpapers, each of which is both the
 * background image and the accent palette the whole app renders through
 * ("custom" = a user-uploaded photo, kept device-local). The earlier generic
 * gradients (aurora/sky/ocean/sunset/forest/midnight/soft/minimal) are gone;
 * an account still carrying one of those ids is simply not "known" here, and
 * clients keep their local choice rather than rendering something unknown.
 */
export const THEME_IDS = ["event-horizon", "violet-dusk", "obsidian-flow", "ember-horizon", "monochrome-terrain", "prism-horizon", "sculpted-bronze", "luminous-violet"];
export const DEFAULT_THEME_ID = "violet-dusk";
/** True when the id is one this build actually knows how to render. */
export const isKnownTheme = (id) =>
  typeof id === "string" && THEME_IDS.includes(id);

/** Storage key for the local "who is signed in" pointer. */
export const SESSION_KEY = "sess";

/** Usernames are keys: lowercase, URL/key-safe, bounded. */
export function slugUsername(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 20);
}

/** "Aarav.Sharma+news@x.com" → "aarav.sharma" (falls back to the id). */
export function usernameFromEmail(email, fallbackId) {
  const local = String(email || "").split("@")[0];
  const slug = slugUsername(local);
  if (slug) return slug;
  const id = String(fallbackId || "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return id ? `user_${id}` : "user";
}

/** The name to show a human: display name → username → email. */
export function displayName(user) {
  if (!user) return "";
  return user.name || user.un || user.email || "";
}

/** First letter for the avatar bubble, never throwing on an empty user. */
export function initial(user) {
  const n = displayName(user).trim();
  return n ? n[0].toUpperCase() : "?";
}

/**
 * Resolve an OAuth arrival against the user's declared intent.
 *
 * OAuth creates the auth user before the app runs, so the intent the person
 * expressed — which screen they used — must be enforced afterwards. The only
 * safe existence signal is the user's OWN profile row (created at signup by
 * the server trigger): asking about it is a self-query under RLS, never an
 * enumeration vector.
 *
 *   - existing account  → admitted from EITHER screen (a signup-tab click by
 *     an existing user is still a legitimate sign-in)
 *   - unknown account   → admitted ONLY from the sign-up tab; from the sign-in
 *     tab it is refused with a pointer to Sign up, so a brand-new account
 *     cannot silently materialize behind the back of a "Log in" button
 *   - unknown probe (error/offline) → admitted as today; a broken check must
 *     never lock legitimate people out of their accounts
 *
 * Pure so every client (web now, mobile next) enforces identical semantics,
 * and testable without a database.
 */
export function resolveOAuthIntent({ accountExists, intent }) {
  if (accountExists) return { action: "admit" };
  if (accountExists === false && intent === "signin") {
    return { action: "refuse", reason: "no-account" };
  }
  return { action: "admit" };
}

/**
 * A brand-new profile, created the first time an account signs in. Everything
 * a client needs to render immediately is present, so no screen has to defend
 * against half-built state.
 */
export function defaultProfile({ un, name, email } = {}) {
  return {
    un,
    name: name || un,
    email: email || "",
    createdAt: Date.now(),
    tasks: [],
    apps: [],
    friends: [],
    pm: { w: 25, sb: 5, lb: 15, sound: false, notify: false },
    blocking: defaultBlocking(),
    // Which of the user's profiles this device has already migrated/seen.
    settingsVersion: 1,
  };
}

/**
 * Fill in a profile loaded from storage: older records predate `blocking`, so
 * upgrade them here (through migrateLegacy) rather than in every screen.
 */
export function hydrateProfile(profile, { un, name, email, migrate } = {}) {
  if (!profile) return null;
  const base = defaultProfile({ un: profile.un || un, name: profile.name || name, email: profile.email || email });
  return {
    ...base,
    ...profile,
    tasks: Array.isArray(profile.tasks) ? profile.tasks : [],
    apps: Array.isArray(profile.apps) ? profile.apps : [],
    friends: Array.isArray(profile.friends) ? profile.friends : [],
    pm: { ...base.pm, ...(profile.pm || {}) },
    blocking: normalizeState(
      profile.blocking ||
        (migrate
          ? migrate({
              trackedApps: Array.isArray(profile.apps) ? profile.apps : [],
            })
          : defaultBlocking())
    ),
  };
}

/**
 * THE mapper. Given whatever Supabase returned (or nothing at all, when the
 * account service is unconfigured) and the profile from local storage, return
 * the single user object the app renders from.
 *
 * Precedence: the stored profile wins for data, Supabase wins for identity.
 *  - `un`   : profile's username, else derived from the email/id (stable key)
 *  - `name` : profile's display name, else Supabase metadata, else the username
 *  - `hasProfile` tells the caller whether to persist a new record
 */
export function toAppUser(supabaseUser, profile) {
  const su = supabaseUser || null;
  const meta = su?.user_metadata || {};
  const email = su?.email || profile?.email || "";
  const un = profile?.un || usernameFromEmail(email, su?.id) || "";

  const name =
    profile?.name ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    un;

  return {
    ...(profile || {}),
    id: su?.id || profile?.id || "",
    un,
    name,
    email,
    avatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : profile?.avatarUrl || "",
    // True when Supabase vouched for this user (real sign-in) rather than the
    // record coming only from this device's storage.
    authLinked: Boolean(su?.id),
    hasProfile: Boolean(profile),
  };
}

/** Fields that must never be written back to storage from a render pass. */
export const transientUserKeys = ["hasProfile", "authLinked"];
