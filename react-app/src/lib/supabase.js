import { createClient } from '@supabase/supabase-js';

// Public (by design) values from react-app/.env.local — see SETUP.md.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A fresh checkout ships .env.local with placeholders ("YOUR_SUPABASE_URL").
// Missing OR placeholder values mean "no account service configured yet" —
// that must NOT be fatal: throwing here happens at import time, so it would
// take the whole app (timer, tasks, boards, heatmap) down with it. Instead we
// export no client and let the UI say plainly which fields are missing.
const placeholder = (v) => !v || /^your_/i.test(String(v).trim());

/**
 * The dashboard shows several URLs, and only one of them is the one
 * supabase-js wants. Pasting the REST endpoint (…/rest/v1/) or an auth/API
 * endpoint makes the client prefix its own path onto it, so every request
 * 404s — a genuinely confusing failure, because the credentials look fine.
 * The client needs the bare origin, so strip a known API suffix and say so
 * loudly rather than failing mysteriously later.
 */
export const normalizedUrl = (() => {
  if (placeholder(supabaseUrl)) return supabaseUrl;
  try {
    const u = new URL(String(supabaseUrl).trim());
    if (!/^https?:$/.test(u.protocol)) return supabaseUrl;
    const isApiPath = /^\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/.test(u.pathname);
    if (isApiPath) {
      console.warn(
        `[north] VITE_SUPABASE_URL includes "${u.pathname}" — using ${u.origin} instead. ` +
          'supabase-js adds its own /auth/v1 and /rest/v1 paths; use the Project URL from SETUP.md.'
      );
      return u.origin;
    }
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
  } catch {
    return supabaseUrl; // malformed: let the checks below report it plainly
  }
})();

export const supabaseConfigured =
  !placeholder(normalizedUrl) &&
  /^https?:\/\//i.test(String(normalizedUrl).trim()) &&
  !placeholder(supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(normalizedUrl, supabaseAnonKey)
  : null;

if (!supabaseConfigured) {
  // A warning, not an exception: everything except real accounts still works.
  console.warn(
    'Supabase is not configured — accounts are unavailable. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to react-app/.env.local (see SETUP.md) and restart the dev server.'
  );
}
