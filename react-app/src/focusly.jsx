import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import FocusTaskPicker from "./FocusTaskPicker.jsx";
import {
  Calendar, Check, ChevronLeft, ChevronRight, Compass,
  Home as HomeIcon, ListChecks, LogOut, Pause, PenLine, Play,
  Plus, RotateCcw, Settings, Shield, SkipForward, Timer, Trash2, Users, X, Eye, EyeOff, Maximize2
} from "lucide-react";
import { supabase, supabaseConfigured, normalizedUrl, supabaseAnonKey } from "./lib/supabase.js";
import { authEventUser, cachedSessionUser } from "./lib/auth-events.js";
// Shared-with-every-client modules (generated copies of packages/shared-types —
// see scripts/sync-shared.mjs). The account mapper and the blocking engine live
// there so the web app, the extension and the phone can never disagree about
// who the user is or what should be blocked.
import {
  migrateLegacy, normalizeHost, normalizeApp, newRule, newSchedule, rulesByKind,
  normalizeState,
  evaluateBlocking, upsertRule, removeRule, setRuleEnabled,
  upsertSchedule, removeSchedule, unblockUntil, upsertUsageLimit, removeUsageLimit,
  WORKDAYS, WEEKDAY_LABELS, defaultBlocking,
  startFocus as startFocusSession,
} from "./shared/blocking.js";
import {
  PROFILE_KEY, SESSION_KEY, toAppUser, defaultProfile, hydrateProfile, initial,
  usernameFromEmail, displayName, resolveOAuthIntent,
} from "./shared/account.js";
// The backend. `createSync` translates the app's storage keys into the tables in
// supabase/schema.sql and mirrors every write; the local store below stays the
// instant, offline-capable cache in front of it. Nothing else in the UI changes.
import { createSync, newUuid } from "./lib/sync.js";
import { dayOf, buildReminderPlan, recordFired, cancelStaleReminders } from "./lib/reminders.js";
import { connectGoogleCalendar, syncGoogleCalendar, disconnectGoogleCalendar } from "./lib/integrations.js";
import { dayView } from "./lib/dayview.js";
import { analyticsSummary, distractionSummary, isHiddenUsageSite } from "./lib/analytics.js";
import { eventTimeLabel } from "./lib/calendar.js";
import { formatTaskDateInput, parseTaskDate, taskDateText } from "./lib/task-date.js";
// North Flow configures blocking rules; the browser extension is
// what actually stops a site loading, so this page can ask it what it is doing.
import { pingExtension, readExtensionUsage, notifyExtension, requestExtensionSync, connectExtensionAccount, extensionChannelOpen, EXTENSION_ID, extensionId, setExtensionId } from "./lib/extension.js";


// ── DESIGN TOKENS ──────────────────────────────────────────────────────
// One palette, derived per ENVIRONMENT (paletteOf, defined with the glass
// registry below); `K` points at the active one and is reassigned by App on
// every environment change. Every color in the UI must come from K so the
// whole surface shifts with the background — never hardcode hex in
// components. Dark environments get light text, light ones get dark text,
// and the accent comes from the environment itself.
// The text palette — the part of K that must follow the ENVIRONMENT's
// luminance, not a light/dark toggle — is derived AFTER the environment
// registry below (paletteOf / paletteForCustomPhoto / K live there).
// ── NORTH VISUAL FOUNDATION ────────────────────────────────────────────
// Shared visual primitives only. Pages/components keep their existing
// structure and behavior; this layer owns color, type, spacing, borders,
// radii and surfaces.
const NORTH_TOKENS = {
  bg: "#08090C",
  surface: "#101218",
  surfaceRaised: "#14161D",
  surfaceSubtle: "#0D0F14",
  text: "#F5F5F7",
  textSecondary: "#A6A7B0",
  textMuted: "#72747E",
  border: "rgba(255,255,255,.09)",
  borderStrong: "rgba(255,255,255,.14)",
  accent: "#8B8FF7",
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  shadow: "0 12px 32px rgba(0,0,0,.24)",
};

// Shared material hierarchy: crisp glass chrome, readable translucent content.
const GLASS = {
  blurPrimary: 24, blurSubtle: 10, blurSheet: 28,
  tintLight: "rgba(255,255,255,.10)", tintLightCard: "rgba(255,255,255,.12)", tintLightSubtle: "rgba(255,255,255,.06)", tintLightStrong: "rgba(255,255,255,.16)",
  tintDark: NORTH_TOKENS.surfaceRaised, tintDarkCard: NORTH_TOKENS.surface, tintDarkSubtle: NORTH_TOKENS.surfaceSubtle, tintDarkStrong: "#171920",
  lumLightA: "transparent", lumLightB: "transparent", lumDarkA: "transparent", lumDarkB: "transparent",
  hiLight: "transparent", hiDark: "transparent",
  edgeLight: "rgba(15, 20, 40, 0.10)", edgeDark: NORTH_TOKENS.border,
  glowAcc: 0,
};
// Per-environment glass values, resolved by `glassOf(envId)`. Each tier is a
// COMBINATION of properties (tint + blur + saturation + luminance + border +
// highlight + depth + shadow), never a single opacity value:
//   primary  — deepest blur, strongest border/highlight, floats with real shadow
//   secondary — tinted, crisp surfaces for reading and working
//   tertiary — low blur and faint edges for recessed controls
//   sheet    — the deepest lens of all: text-bearing floating chrome
// ── ENVIRONMENTS ────────────────────────────────────────────────────────
// The background IS the design, and the background is a real photograph.
//
// Each environment is one of the five built-in North wallpapers plus the
// accent its palette contributes to the WHOLE app: `acc` becomes K.acc, so
// the sidebar, Focus, Tasks, Calendar, Social and Settings all shift
// together. `onAcc` is the ink that stays readable on a filled accent button
// — these accents are deliberately light (gold, lavender, orange, silver), so
// white text on them would be unreadable; the ink is chosen per environment
// rather than hardcoded white next to every button.
//
// `pools` are soft light fields painted UNDER the image (they only show at
// the edges and through the scrim) and `scrim` is the per-wallpaper
// readability gradient: darker where the header and dock sit, lighter through
// the middle, so the art stays visible instead of being flattened by one big
// opaque rectangle. The image itself is a fixed layer (see .envwall) so it
// never scrolls with content.
const ENVS = {
  "event-horizon": {
    lbl: "Event Horizon", dark: true, acc: "#F0B65A", onAcc: "#0B0B0E",
    img: "wallpapers/event-horizon-v2.png",
    base: "#070808",
    scrim: "linear-gradient(180deg, rgba(7,8,8,.62) 0%, rgba(17,16,15,.30) 42%, rgba(7,8,8,.68) 100%)",
    pools: [
      "radial-gradient(1100px 780px at 14% -10%, rgba(217, 138, 58, 0.16), transparent 64%)",
      "radial-gradient(950px 700px at 86% 32%, rgba(240, 182, 90, 0.10), transparent 62%)",
    ],
    glass: "245, 217, 160", sh: "0, 0, 0",
  },
  "violet-dusk": {
    lbl: "Violet Dusk", dark: true, acc: "#A996E8", onAcc: "#0B0B0E",
    img: "wallpapers/violet-dusk-v2.png",
    base: "#070816",
    scrim: "linear-gradient(180deg, rgba(7,8,22,.62) 0%, rgba(17,19,44,.30) 45%, rgba(7,8,22,.70) 100%)",
    pools: [
      "radial-gradient(1100px 780px at 16% -10%, rgba(114, 87, 199, 0.20), transparent 64%)",
      "radial-gradient(940px 700px at 88% 40%, rgba(169, 150, 232, 0.12), transparent 62%)",
    ],
    glass: "216, 208, 255", sh: "0, 0, 0",
  },
  "obsidian-flow": {
    lbl: "Obsidian Flow", dark: true, acc: "#B8B8B8", onAcc: "#0B0B0E",
    img: "wallpapers/obsidian-flow-v2.png",
    base: "#070707",
    scrim: "linear-gradient(180deg, rgba(7,7,7,.66) 0%, rgba(17,17,17,.34) 45%, rgba(7,7,7,.72) 100%)",
    pools: [
      "radial-gradient(1000px 720px at 18% -8%, rgba(184, 184, 184, 0.08), transparent 66%)",
      "radial-gradient(900px 660px at 88% 46%, rgba(74, 74, 74, 0.12), transparent 64%)",
    ],
    glass: "184, 184, 184", sh: "0, 0, 0",
  },
  "ember-horizon": {
    lbl: "Ember Horizon", dark: true, acc: "#FF7A3D", onAcc: "#0B0B0E",
    img: "wallpapers/ember-horizon-v2.png",
    base: "#08090A",
    scrim: "linear-gradient(180deg, rgba(8,9,10,.58) 0%, rgba(23,25,29,.26) 45%, rgba(8,9,10,.66) 100%)",
    pools: [
      "radial-gradient(1100px 800px at 50% 108%, rgba(240, 90, 40, 0.18), transparent 62%)",
      "radial-gradient(920px 680px at 14% -8%, rgba(38, 40, 45, 0.55), transparent 64%)",
    ],
    glass: "243, 233, 223", sh: "0, 0, 0",
  },
  "monochrome-terrain": {
    lbl: "Monochrome Terrain", dark: true, acc: "#B0B0B0", onAcc: "#0B0B0E",
    img: "wallpapers/monochrome-terrain-v2.png",
    base: "#080808",
    scrim: "linear-gradient(180deg, rgba(8,8,8,.64) 0%, rgba(24,24,24,.32) 45%, rgba(8,8,8,.70) 100%)",
    pools: [
      "radial-gradient(1000px 720px at 20% -10%, rgba(176, 176, 176, 0.07), transparent 66%)",
      "radial-gradient(900px 660px at 86% 50%, rgba(104, 104, 104, 0.12), transparent 64%)",
    ],
    glass: "176, 176, 176", sh: "0, 0, 0",
  },
  "sculpted-bronze": {
    lbl: "Sculpted Bronze", dark: true, acc: "#D2A176", onAcc: "#17110D",
    img: "wallpapers/sculpted-bronze-ribbon.png", base: "#251B17",
    scrim: "linear-gradient(180deg, rgba(20,13,10,.36), rgba(20,13,10,.08) 46%, rgba(10,12,19,.32))",
    pools: ["radial-gradient(980px 680px at 12% 0%, rgba(196,128,78,.20), transparent 65%)", "radial-gradient(900px 650px at 90% 70%, rgba(181,165,151,.14), transparent 65%)"],
    glass: "229, 198, 175", sh: "29, 19, 14",
  },
  "luminous-violet": {
    lbl: "Luminous Violet", dark: true, acc: "#D694FF", onAcc: "#190B24",
    img: "wallpapers/luminous-violet-ribbon.png", base: "#180B24",
    scrim: "linear-gradient(180deg, rgba(15,5,26,.44), rgba(20,7,32,.12) 46%, rgba(10,5,24,.48))",
    pools: ["radial-gradient(1000px 700px at 12% 0%, rgba(194,78,255,.18), transparent 65%)", "radial-gradient(900px 650px at 90% 70%, rgba(255,116,162,.14), transparent 65%)"],
    glass: "237, 211, 255", sh: "22, 8, 34",
  },
};
const ENV_IDS = Object.keys(ENVS);
const DEFAULT_ENV_ID = "sculpted-bronze";
const isKnownEnv = (id) => ENV_IDS.includes(id);
const THEME_INTENT_KEY = "north:pending-theme";
const readThemeIntent = (un) => {
  try {
    const intent = JSON.parse(localStorage.getItem(THEME_INTENT_KEY) || "null");
    return intent?.un === un && isKnownEnv(intent.id) ? intent : null;
  } catch { return null; }
};
const clearThemeIntent = (intent) => {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_INTENT_KEY) || "null");
    if (saved?.un === intent.un && saved?.at === intent.at) localStorage.removeItem(THEME_INTENT_KEY);
  } catch {}
};
const isPreviewHarness = () =>
  typeof window !== "undefined" && /\/preview\.html$/i.test(window.location.pathname);

// Custom photo environment — the photo becomes the full-viewport backdrop;
// the glass recipe adapts to the user's brightness/overlay controls, so a
// bright photo gets brighter glass and a dark one gets heavier smoke.
const PHOTO_DEFAULTS = { pos: "50% 50%", zoom: 1, bright: 1, blur: 0, overlay: 0.35 };
const photoGlass = (adj) => {
  // Photos are unpredictable — a bright sky region can sit exactly where the
  // greeting renders. Default to the dark/smoke treatment (light text over a
  // dimming scrim). The user switches to the light treatment by raising
  // brightness and pulling the dim slider down — an explicit "this photo is
  // bright" statement. The scrim keeps either choice readable.
  const dark = !((adj.bright || 1) >= 1.1 && (adj.overlay || 0) <= 0.15);
  return {
    dark,
    tint: "rgba(255,255,255,.10)",
    tintCard: "rgba(255,255,255,.14)",
    tintSubtle: "rgba(255,255,255,.07)",
    tintStrong: "rgba(255,255,255,.20)",
    lumA: "rgba(255, 255, 255, 0.08)",
    lumB: dark ? "rgba(255, 255, 255, 0.015)" : "rgba(255, 255, 255, 0.015)",
    hi: dark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.14)",
    edge: "rgba(255,255,255,.24)",
    satPrimary: "saturate(155%)",
    satCard: "saturate(140%)",
    satSubtle: "saturate(125%)",
    shFloat: `0 18px 48px -12px rgba(0, 0, 0, ${dark ? 0.55 : 0.20}), 0 4px 14px rgba(0, 0, 0, ${dark ? 0.30 : 0.08})`,
    shCard: `0 2px 6px rgba(0, 0, 0, ${dark ? 0.22 : 0.06}), 0 12px 32px -14px rgba(0, 0, 0, ${dark ? 0.38 : 0.12})`,
    acc: dark ? "#0A84FF" : "#007AFF",
  };
};

// Per-environment glass values, resolved by `glassOf(envId)`. Each tier is a
// COMBINATION of properties (tint + blur + saturation + luminance + border +
// highlight + depth + shadow), never a single opacity value — and the tint
// carries the ENVIRONMENT's hue, so cool scenes cast cool glass and warm
// scenes cast warm glass:
//   primary  — deepest blur, strongest border/highlight, floats with real shadow
//   secondary — medium blur, the everyday reading surface
//   tertiary — no blur (sits close to the plane), faintest edges, recessed
//   sheet    — the deepest lens of all: text-bearing floating chrome
const envGlass = (e) => ({
  tint: "rgba(255,255,255,.10)",
  tintCard: "rgba(255,255,255,.14)",
  tintSubtle: "rgba(255,255,255,.07)",
  tintStrong: "rgba(255,255,255,.20)",
  lumA: "rgba(255,255,255,.08)",
  lumB: e.dark ? "rgba(255,255,255,.015)" : "rgba(255,255,255,.015)",
  hi: "rgba(255,255,255,.22)",
  edge: "rgba(255,255,255,.24)",
  satPrimary: "saturate(140%)", satCard: "saturate(132%)", satSubtle: "saturate(125%)",
  shFloat: NORTH_TOKENS.shadow,
  shCard: "0 1px 2px rgba(0,0,0,.18)",
  acc: e.acc,
});
const glassOf = (envId) => {
  if (envId === "custom") return photoGlass(PHOTO_CURRENT || PHOTO_DEFAULTS);
  return envGlass(ENVS[isKnownEnv(envId) ? envId : DEFAULT_ENV_ID]);
};
// Set by App before first glass resolution when a photo env is active.
let PHOTO_CURRENT = null;

// The text palette — the part of K that must follow the ENVIRONMENT's
// luminance, not a light/dark toggle. Dark scenes get light text, light
// scenes get dark text; the accent comes from the environment itself so a
// sunset scene warms the whole UI and a minimal scene stays neutral.
const paletteOf = (envId) => {
  const e = ENVS[isKnownEnv(envId) ? envId : DEFAULT_ENV_ID];
  const dark = !!e.dark;
  return {
    dark,
    bg: dark ? NORTH_TOKENS.bg : "#EDF0F7",
    surf: "rgba(255,255,255,.10)",
    card: "rgba(255,255,255,.13)",
    card2: "rgba(255,255,255,.07)",
    border: "rgba(255,255,255,.24)",
    acc: e.acc,
    // Ink that stays readable on a filled accent control. Declared per
    // environment (see ENVS) because these accents are light by design.
    onAcc: e.onAcc || "#FFFFFF",
    accDim: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.5)",
    ok: dark ? "#30D158" : "#34C759", warn: dark ? "#FF9F0A" : "#FF9500", err: dark ? "#FF453A" : "#FF3B30",
    txt: dark ? "#F2F2F7" : "#1C1C1E", sub: dark ? "#B7B8C0" : "#56565C", muted: dark ? "#85868E" : "#77777D",
    sh1: dark ? "0 1px 2px rgba(0, 0, 0, 0.5)" : "0 1px 2px rgba(31, 41, 66, 0.06)",
    sh2: dark ? "0 2px 6px rgba(0, 0, 0, 0.45)" : "0 2px 6px rgba(31, 41, 66, 0.08)",
    sh3: dark ? "0 -6px 12px rgba(0, 0, 0, 0.45)" : "0 -6px 12px rgba(31, 41, 66, 0.05)",
  };
};
const paletteForCustomPhoto = (adj) => {
  const g = photoGlass({ ...PHOTO_DEFAULTS, ...(adj || {}) });
  return { ...paletteOf(DEFAULT_ENV_ID), dark: g.dark, acc: g.acc,
    // The photo path keeps the blue accent, which takes white ink.
    onAcc: "#FFFFFF",
    txt: g.dark ? "#F2F2F7" : "#1C1C1E", sub: g.dark ? "#98989E" : "#6D6D72", muted: g.dark ? "#636366" : "#AFAFB6",
    border: g.edge, bg: g.dark ? "#0C0D12" : "#EDF0F7" };
};
let K = paletteOf(DEFAULT_ENV_ID); // active palette — App reassigns on environment change

// Shared surface recipes keep glass consistent across every web screen.
const glassHeader = (g) => ({
  background: `linear-gradient(145deg, ${g.lumA}, ${g.lumB}), ${g.tint}`,
  backdropFilter: `blur(${GLASS.blurPrimary}px) saturate(140%)`,
  WebkitBackdropFilter: `blur(${GLASS.blurPrimary}px) saturate(140%)`,
  border: `1px solid ${g.edge}`,
  boxShadow: `inset 0 1px 0 ${g.hi}, 0 1px 2px rgba(0,0,0,.18)`,
});
const glassCard = (g) => ({
  background: `linear-gradient(145deg, ${g.lumA}, ${g.lumB} 52%, transparent), ${g.tintCard}`,
  border: `1px solid ${g.edge}`,
  boxShadow: `inset 0 1px 0 ${g.hi}, inset 0 -1px 0 rgba(0,0,0,.08), ${g.shCard}`,
});
const glassSubtle = (g) => ({
  background: `linear-gradient(145deg, ${g.lumA}, transparent 58%), ${g.tintSubtle}`,
  backdropFilter: `blur(${GLASS.blurSubtle}px) saturate(125%)`,
  WebkitBackdropFilter: `blur(${GLASS.blurSubtle}px) saturate(125%)`,
  border: `1px solid ${g.edge}`,
  boxShadow: `inset 0 1px 0 ${g.hi}`,
});
const glassFloat = (g) => ({
  background: `linear-gradient(145deg, ${g.lumA}, ${g.lumB}), ${g.tint}`,
  backdropFilter: `blur(${GLASS.blurSheet}px) saturate(145%)`,
  WebkitBackdropFilter: `blur(${GLASS.blurSheet}px) saturate(145%)`,
  border: `1px solid ${g.edge}`,
  boxShadow: `inset 0 1px 0 ${g.hi}, inset 0 -1px 0 rgba(0,0,0,.12), ${g.shFloat}`,
});
// The environment behind everything — LEVEL 0 and 1 of the depth stack.
// A preset renders its base + light fields; a photo renders the image itself
// with the user's adjustments. The pools breathe very slowly (transform-only,
// disabled under prefers-reduced-motion via the .genv classes in `G`) so the
// glass always has living light to catch.
const GLASS_ENV = (envId, photo) => {
  const isPhoto = envId === "custom" && photo && photo.data;
  if (isPhoto) {
    const a = { ...PHOTO_DEFAULTS, ...(photo.adj || {}) };
    return {
      minHeight: "100vh",
      position: "relative",
      "--envPhoto": `url("${photo.data}")`,
      "--envPos": a.pos, "--envZoom": String(a.zoom), "--envPhotoSize": `${Math.round(a.zoom * 100)}% auto`,
      "--envBright": String(a.bright), "--envBlur": `${a.blur}px`, "--envDim": String(a.overlay),
    };
  }
  const e = ENVS[isKnownEnv(envId) ? envId : DEFAULT_ENV_ID];
  return {
    minHeight: "100vh",
    // The pools + base sit UNDER the fixed image layer, so they only read at
    // the edges and anywhere the scrim thins out.
    background: [...e.pools, e.base].join(","),
    backgroundColor: e.base,
    position: "relative",
    // Consumed by .envwall / .envwall::after (see `G`).
    "--envWall": `url("${e.img}")`,
    "--envScrim": e.scrim,
  };
};
// Full-viewport photo layer for the custom environment. Fixed-position so it
// behaves like wallpaper: it never scrolls with content. `.envphoto` styles
// live in `G` so they can be stilled by reduced-motion/transparency.
const ENV_PHOTO_LAYER = (envId, photo) =>
  envId === "custom" && photo && photo.data ? <div aria-hidden="true" className="envphoto" /> : null;

/**
 * ENV_WALL_LAYER — the built-in wallpaper, rendered as its own fixed layer so
 * it never scrolls and so only the ACTIVE environment's image is ever
 * requested (the URL lives in a CSS custom property on this one element, not
 * in a list of five preloaded ones). One optimized JPEG per environment, all
 * under 140 KB; nothing animates.
 */
const ENV_WALL_LAYER = (envId) =>
  isKnownEnv(envId) ? <div aria-hidden="true" className="envwall" /> : null;

// Active right-click policy for this render pass (same pattern as `K`). It is a
// VIEW preference only — it never changes what is blocked — and its default,
// "native", means NORTH does not touch the browser's own menu at all.

// System-first type stack. Apple's SF Pro is licensed only for Apple
// platforms (and can't be embedded in a web app), so the authentic approach
// — the one apple.com itself uses — is to prefer each device's own UI font:
// SF Pro on Apple gear, Segoe UI Variable on Windows, Roboto on Android.
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// ── STORAGE ─────────────────────────────────────────────────────────────
// The app was built to run inside a host that injects `window.storage`
// (keys are JSON strings; `shared=true` is the multi-device namespace). When
// that host API is missing — a plain browser tab, local dev — fall back to
// localStorage so data genuinely persists, then to an in-memory store for
// private-mode / non-browser contexts. The real sync backend will plug in
// here later: S.* is the only place that touches storage.
const memStore = () => {
  const m = new Map();
  return {
    get:    async (k, s) => { const v = m.get((s ? "s:" : "") + k); return v === undefined ? null : { value: v }; },
    set:    async (k, v, s) => { m.set((s ? "s:" : "") + k, v); },
    delete: async (k, s) => { m.delete((s ? "s:" : "") + k); },
    list:   async (p, s) => {
      const pre = (s ? "s:" : "") + p;
      return { keys: [...m.keys()].filter((k) => k.startsWith(pre)).map((k) => (s ? k.slice(2) : k)) };
    },
  };
};
const localStore = () => {
  const ls = window.localStorage;
  return {
    get:    async (k, s) => { const v = ls.getItem((s ? "s:" : "") + k); return v === null ? null : { value: v }; },
    set:    async (k, v, s) => { ls.setItem((s ? "s:" : "") + k, v); },
    delete: async (k, s) => { ls.removeItem((s ? "s:" : "") + k); },
    list:   async (p, s) => {
      const pre = (s ? "s:" : "") + p;
      const keys = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(pre)) keys.push(s ? k.slice(2) : k);
      }
      return { keys };
    },
  };
};
let cache = null;
const pick = () => {
  if (cache) return cache;
  const w = typeof window !== "undefined" ? window : null;
  if (w && w.storage) return (cache = w.storage);
  if (w && w.localStorage) {
    try { const k = "__f_probe"; w.localStorage.setItem(k, "1"); w.localStorage.removeItem(k); return (cache = localStore()); }
    catch { /* private mode or blocked → in-memory */ }
  }
  return (cache = memStore());
};
// The backend mirror, created immediately below once `S` exists. Declared here
// (before S) so `S`'s methods can reference it without a temporal-dead-zone
// error on the very first call.
let SYNC = null;

const S = {
  async get(key, shared = false) {
    try { const r = await pick().get(key, shared); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(key, val, shared = false) {
    try { await pick().set(key, JSON.stringify(val), shared); } catch {}
    // Mirror the change to the account's backend — a no-op when signed out or
    // when no Supabase project is configured, and never awaited: recording a
    // task must not wait on a network round trip. `sync.js` queues the push and
    // retries it until it lands, so an offline edit is not lost.
    if (SYNC) SYNC.afterWrite(key, shared);
  },
  async del(key, shared = false) {
    try { await pick().delete(key, shared); } catch {}
  },
  /**
   * `live` (default true) controls whether a shared list is REFRESHED from the
   * server first. The leaderboard is the one shared list that must be live
   * rather than cached — it is an aggregate on the server, not rows this device
   * holds — but a caller that needs to paint immediately (before/without a
   * network round trip) can pass `false` and read the cache as it stands.
   */
  async list(prefix, shared = false, live = true) {
    if (live && shared && prefix === "lb:" && SYNC && SYNC.ready()) {
      await SYNC.leaderboard().catch(() => {});
    }
    try { const r = await pick().list(prefix, shared); return r?.keys || []; }
    catch { return []; }
  },
};

// The client is injected (not imported by the engine) so the same sync module
// can load on the web, on the phone and in Node — see the note in lib/sync.js.
SYNC = createSync({ store: S, client: supabase, configured: supabaseConfigured });

// ── HELPERS ──────────────────────────────────────────────────────────────
// Ids are UUIDs: the database's primary keys are `uuid`, so the same id is
// valid on every client and each write becomes idempotent (a focus session
// pushed twice updates one row instead of creating a duplicate).
const uid  = () => newUuid();

// ── NETWORK DEADLINES ────────────────────────────────────────────────────
// Supabase's client has no request timeout, and a browser `fetch` against a
// black-holed network can stay pending indefinitely. Any screen that awaits a
// request purely to decide what to render must bound it, or the user is left
// on a spinner that never resolves. `withTimeout` rejects with a recognizable
// sentinel so the caller can say something true about what happened.
const TIMEOUT = "__north_timeout__";
const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(TIMEOUT)), ms);
  Promise.resolve(p).then(
    (v) => { clearTimeout(t); resolve(v); },
    (e) => { clearTimeout(t); reject(e); },
  );
});

const pad2 = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const yesterday = () => {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// ── SHARED STYLES ────────────────────────────────────────────────────────
// Functions (not constants) so they re-evaluate against the active theme on
// every render. Surfaces come from the North Glass material (`glassCard` etc.)
// resolved for the active appearance — every screen inherits the material
// without scattering one-off glass styles.
let GK = glassOf("light"); // active glass tokens — App reassigns with K
// box-sizing: border-box — these surfaces are routinely given width:"100%",
// and with content-box sizing their 32px of horizontal padding was added on
// top of that, pushing the card (and the heatmap scroller inside it) past the
// page edge on a narrow phone.
const card  = () => ({ ...glassCard(GK), borderRadius: 14, padding: "14px 16px", boxSizing: "border-box" });
const card2 = () => ({ ...glassSubtle(GK), borderRadius: 12, padding: "12px 14px" });
const inpSt = () => ({
  width: "100%", padding: "10px 12px", borderRadius: 10, boxSizing: "border-box",
  background: GK.tintSubtle, border: `1px solid ${GK.edge}`, color: K.txt,
  fontSize: 13, fontFamily: "inherit",
});
const tag = (active, col) => ({
  padding: "4px 11px", borderRadius: 20, fontSize: 11, cursor: "pointer",
  fontWeight: 500, transition: "all .15s",
  background: active ? col + "22" : GK.tintSubtle,
  border: `1px solid ${active ? col : GK.edge}`,
  color: active ? col : K.sub,
});

// ── PAGE SHELL ───────────────────────────────────────────────────────────
// Every screen shares one measure. 1060px is deliberately wider than the old
// 900: with the sidebar eating 208px, 900 left a third of a laptop screen as
// bare wallpaper and squeezed real content (a 7-column calendar, three kanban
// columns) into a column that read as "tiny controls floating in the middle".
// It stays a fixed measure rather than full-bleed so line lengths and the
// calendar grid keep their proportions on a wide display.
const PAGE_W = 1060;
// Screens wrap themselves in `<div className="npage">`; the measure, the
// gutters and the large-display width are all in that one rule inside `G`, so
// the page frame is part of the responsive system instead of a fixed number
// baked into each screen's inline style.
// A lighter surface than `card()` for the few LARGE areas that have to sit on
// the wallpaper (the month grid, a long list). A faint tint plus a hairline
// organises the content without erasing the environment behind it — the
// difference between the two is the whole point of this pass.
const softPanel = () => ({
  borderRadius: 16,
  background: `linear-gradient(145deg, ${GK.lumA}, transparent 58%), ${GK.tintSubtle}`,
  backdropFilter: `blur(${GLASS.blurSubtle}px) saturate(125%)`,
  WebkitBackdropFilter: `blur(${GLASS.blurSubtle}px) saturate(125%)`,
  border: `1px solid ${GK.edge}`, boxSizing: "border-box",
});

/** The one page-title style: the largest thing on any screen after the timer. */
const pageTitle = () => ({
  color: K.txt, fontSize: 23, fontWeight: 650, letterSpacing: "-0.02em", margin: 0,
});
/** A section heading *inside* a page — bigger than body, quieter than the title. */
const sectionTitle = () => ({ fontSize: 14.5, fontWeight: 650, color: K.txt, letterSpacing: "-0.01em" });

// Small injected stylesheet (hover/press/focus need real CSS, inline styles
// can't do :hover). Rendered with the active palette by every top-level view.
// Shared interactions and accessibility fallbacks for the Liquid Glass UI.
const G = () => (
  <style>{`
  /* One material language across page surfaces, with stronger glass at the edges. */
  :root { --north-bg:${NORTH_TOKENS.bg}; --north-surface:${NORTH_TOKENS.surface}; --north-surface-raised:${NORTH_TOKENS.surfaceRaised}; --north-border:${NORTH_TOKENS.border}; --north-accent:${NORTH_TOKENS.accent}; --north-radius-sm:${NORTH_TOKENS.radiusSm}px; --north-radius-md:${NORTH_TOKENS.radiusMd}px; --north-radius-lg:${NORTH_TOKENS.radiusLg}px; }
  .gcard { border-radius: ${NORTH_TOKENS.radiusLg}px; color: ${K.txt}; background: linear-gradient(145deg, ${GK.lumA}, ${GK.lumB} 52%, transparent), ${GK.tintCard}; border: 1px solid ${GK.edge}; backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(135%); -webkit-backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(135%); box-shadow: inset 0 1px 0 ${GK.hi}, inset 0 -2px 0 rgba(30,40,70,.08), 0 2px 6px rgba(20,30,65,.08), 0 18px 42px -20px rgba(20,30,65,.30); transform: translateZ(0); }
  .gsheet { border-radius: ${NORTH_TOKENS.radiusLg}px; color: ${K.txt}; background: linear-gradient(145deg, ${GK.lumA}, ${GK.lumB}), ${GK.tintStrong}; border: 1px solid ${GK.edge}; box-shadow: inset 0 1px 0 ${GK.hi}, ${GK.shFloat}; }
  .mtrl { backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(140%); -webkit-backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(140%); }
  .gsheet { backdrop-filter: blur(${GLASS.blurSheet}px) saturate(145%); -webkit-backdrop-filter: blur(${GLASS.blurSheet}px) saturate(145%); }
  button, input, select, textarea { font: inherit; }
  button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid ${K.acc}; outline-offset: 3px; }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .mtrl, .gsheet, .gcard, .gsub, .north-sidebar, .north-spotify, .north-mobile-nav { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: ${K.surf} !important; background-image: none !important; border-color: ${K.border} !important; }
  }
  /* Tertiary glass — recessed rows/wells. No lens by design (close to the
     plane); the inner highlight is what still reads as glass. */
  .gsub { border-radius: 12px; background: ${GK.tintSubtle};
          border: 1px solid ${GK.edge}; box-shadow: inset 0 1px 0 ${GK.hi}; }
  .gsub { background-image: linear-gradient(145deg, ${GK.lumA}, transparent 58%); backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(125%); -webkit-backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(125%); }
  .focus-context-card, .focus-settings-trigger, .focus-history { background-image: linear-gradient(145deg, ${GK.lumA}, transparent 58%); backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(125%); -webkit-backdrop-filter: blur(${GLASS.blurSubtle}px) saturate(125%); }
  .focus-settings-panel, .focus-stat-card { background-image: linear-gradient(145deg, ${GK.lumA}, ${GK.lumB} 52%, transparent); box-shadow: inset 0 1px 0 ${GK.hi}, ${GK.shCard}; }
  /* The environment's slow breathing — transform-only, honest depth cue.
     Two pooled light layers drift on ~60 s and ~85 s periods, out of phase,
     so no two moments look identical and nothing loops noticeably. */
  .genv { position: relative; overflow-x: clip; }
  .genv::before, .genv::after { content:none; }
  /* Sheet presentation: rise + settle — opacity/transform only. */
  @keyframes gsheetIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
  .gsheet { animation: gsheetIn .32s cubic-bezier(.2,.8,.3,1) both; }
  /* Everything the app renders sits above the environment's light pools. */
  .genv > * { position: relative; z-index: 1; }
  .genv > .envwall, .genv > .envphoto { position: fixed !important; z-index: 0 !important; }
  /* The Focus page is the environment, not a panel laid on top of it. The
     shell root already paints the environment once, so this page must NOT
     repaint it: an earlier version spread GLASS_ENV here, which set the
     opaque base colour as this element's own background and produced exactly
     the "giant black dashboard card" the focus screen was criticised for.
     Transparent now, with one soft readability pool under the timer column
     (below) so the wallpaper stays continuous AND the timer stays legible. */
  .focus-world { min-height: 100vh; overflow: hidden; isolation: isolate; background: transparent !important; }
  .focus-world::after {
    content: ""; position: absolute; z-index: 0; pointer-events: none;
    left: 50%; top: 0; transform: translateX(-50%);
    width: min(820px, 100%); height: 100%;
    background: none;
  }
  .focus-inner { position: relative; z-index: 2; width: min(${PAGE_W}px, 100%); margin: 0 auto; padding: 30px 22px 56px; box-sizing: border-box; }
  .focus-atmosphere { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
  .focus-orb { position: absolute; width: 42vw; height: 42vw; max-width: 620px; max-height: 620px; border-radius: 50%; filter: blur(70px); opacity: .20; transform: translate3d(0,0,0); animation: focusDrift 28s ease-in-out infinite alternate; }
  .focus-orb-a { left: -18%; top: -12%; background: radial-gradient(circle, color-mix(in srgb, var(--focus-accent) 32%, transparent), transparent 68%); }
  .focus-orb-b { right: -16%; top: 24%; width: 36vw; height: 36vw; background: radial-gradient(circle, color-mix(in srgb, var(--focus-warn) 22%, transparent), transparent 70%); animation-duration: 36s; animation-direction: alternate-reverse; }
  .focus-orb-c { left: 30%; bottom: -28%; width: 40vw; height: 34vw; background: radial-gradient(circle, color-mix(in srgb, var(--focus-ok) 18%, transparent), transparent 70%); animation-duration: 44s; }
  .focus-grain { position: absolute; inset: -50%; opacity: .045; background-image: repeating-radial-gradient(circle at 20% 30%, ${K.txt} 0 1px, transparent 1px 5px); background-size: 8px 8px; mix-blend-mode: overlay; }
  @keyframes focusDrift { from { transform: translate3d(-2%, -1%, 0) scale(.98); } to { transform: translate3d(3%, 2%, 0) scale(1.04); } }
  .focus-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
  .focus-heading-start { display: flex; align-items: center; gap: 12px; }
  .focus-kicker { color: K.acc; font-size: 10px; font-weight: 700; letter-spacing: .14em; margin-bottom: 8px; }
  .focus-ambient-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .focus-mini-action { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 12px; border-radius: 12px; color: ${K.sub}; font-size: 12px; }
  .focus-context-row { display: flex; align-items: stretch; gap: 10px; margin-bottom: 16px; }
  .focus-context-card { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 14px; background: ${GK.tintSubtle}; border: 1px solid ${GK.edge}; box-shadow: inset 0 1px 0 ${GK.hi}; }
  .focus-phase-tabs { max-width: 620px; margin-left: auto; margin-right: auto; }
  .focus-hero { position: relative; flex-direction: column; align-items: center; padding: 22px 0 0; }
  .focus-hero-glow { position: absolute; width: 320px; height: 320px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--focus-accent) 12%, transparent), transparent 68%); filter: blur(16px); }
  .focus-hero > .gcard { z-index: 1; }
  .focus-dial { background-image: linear-gradient(145deg, ${GK.lumA}, ${GK.lumB} 52%, transparent), ${GK.tint}; backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(145%); -webkit-backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(145%); border-color: ${GK.hi}; box-shadow: inset 0 1px 0 ${GK.hi}, inset 0 -2px 2px rgba(0,0,0,.18), 0 22px 70px rgba(0,0,0,${K.dark ? ".38" : ".12"}); }
  .flow-analytics { display: grid; gap: 14px; padding: 0 !important; margin-bottom: 14px; background: transparent !important; border: 0 !important; box-shadow: none !important; }
  .flow-analytics-header { display: flex; align-items: center; gap: 8px; margin-bottom: 0; }
  .flow-analytics-header > div { flex: 1; min-width: 0; }
  .flow-analytics-header h3 { margin: 0; color: ${K.txt}; font-size: 19px; font-weight: 650; }
  .flow-analytics-header p { margin: 4px 0 0; color: ${K.sub}; font-size: 11px; }
  .flow-analytics-top { display: grid; grid-template-columns: minmax(0,1.45fr) minmax(260px,.8fr); gap: 14px; align-items: stretch; }
  .flow-time-chart, .flow-stat, .flow-pie-panel { min-width: 0; padding: 16px; border-radius: 16px; background: ${GK.tintSubtle}; border: 1px solid ${GK.edge}; box-shadow: inset 0 1px 0 ${GK.hi}; }
  .flow-chart-title { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; color: ${K.txt}; }
  .flow-chart-title strong { font-size: 16px; }
  .flow-chart-title span, .flow-chart-note { color: ${K.sub}; font-size: 10px; }
  .flow-time-chart svg { display: block; width: 100%; margin-top: 8px; overflow: visible; }
  .flow-chart-note { margin: 0; }
  .flow-stat-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
  .flow-stat { display: flex; flex-direction: column; justify-content: space-between; min-height: 92px; }
  .flow-stat span { color: ${K.sub}; font-size: 10px; letter-spacing: .05em; }
  .flow-stat strong { color: ${K.txt}; font-size: clamp(22px,3vw,34px); font-weight: 500; font-variant-numeric: tabular-nums; }
  .flow-analytics-lower { display: grid; grid-template-columns: minmax(260px,.9fr) minmax(0,1.2fr); gap: 20px; margin-top: 18px; }
  .flow-device-list h4 { margin: 2px 0 12px; color: ${K.txt}; font-size: 15px; }
  .flow-target-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 4px; border-bottom: 1px solid ${K.border}; color: ${K.txt}; }
  .flow-target-row > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .flow-target-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .flow-target-row small { color: ${K.sub}; font-size: 10px; }
  .flow-target-row > span { flex-shrink: 0; color: ${K.sub}; font-size: 12px; font-variant-numeric: tabular-nums; }
  .flow-pie-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
  .flow-pie-title { margin-bottom: 16px; color: ${K.sub}; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .flow-pie-content { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .flow-pie { width: min(176px,46%); aspect-ratio: 1; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; }
  .flow-pie span { width: 62%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 50%; background: ${K.bg}; color: ${K.txt}; font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; box-shadow: inset 0 0 0 1px ${K.border}; }
  .flow-pie-legend { min-width: 0; flex: 1; display: grid; gap: 7px; }
  .flow-pie-legend > div { min-width: 0; display: grid; grid-template-columns: 8px minmax(0,1fr) auto; gap: 6px; align-items: center; color: ${K.txt}; font-size: 10px; }
  .flow-pie-legend i { width: 8px; height: 8px; border-radius: 50%; }
  .flow-pie-legend span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .flow-pie-legend small { color: ${K.sub}; font-size: 9px; }
  .flow-empty { color: ${K.sub}; font-size: 11px; line-height: 1.5; }
  @media (max-width: 820px) { .flow-analytics-top, .flow-analytics-lower { grid-template-columns: 1fr; } }
  @media (max-width: 520px) { .flow-analytics-header { flex-wrap: wrap; } .flow-pie-grid { grid-template-columns: 1fr; } .flow-pie { width: min(176px,46%); } .flow-time-chart, .flow-stat, .flow-pie-panel { padding: 14px; } }
  .north-spotify { width: min(420px, 100%); margin: 0 auto 18px; padding: 10px 16px; color: ${K.txt}; border: 1px solid ${GK.edge}; border-radius: 22px; background: linear-gradient(145deg, ${GK.lumA}, ${GK.lumB}), ${GK.tint}; box-shadow: inset 0 1px 0 ${GK.hi}, inset 0 -1px 0 rgba(0,0,0,.12), ${GK.shFloat}; backdrop-filter: blur(${GLASS.blurSheet}px) saturate(150%); -webkit-backdrop-filter: blur(${GLASS.blurSheet}px) saturate(150%); }
  .north-spotify > summary { display: flex; align-items: center; min-height: 30px; cursor: pointer; font-size: 12px; font-weight: 650; color: ${K.txt}; list-style: none; }
  .north-spotify > summary::-webkit-details-marker { display: none; }
  .north-spotify[open] > summary { padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid ${GK.edge}; }
  .focus-start { width: 80px; height: 48px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #fff; }
  .focus-settings-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; padding: 0 14px; border-radius: 14px; color: ${K.txt}; background: ${GK.tintSubtle}; border: 1px solid ${GK.edge}; }
  .focus-settings-trigger span { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
  .focus-settings-panel { margin-top: 8px; padding: 16px; border-radius: 16px; background: ${GK.tintCard}; border: 1px solid ${GK.edge}; box-shadow: ${GK.shCard}; }
  .focus-settings-title { font-size: 10px; color: ${K.sub}; letter-spacing: .08em; font-weight: 700; }
  .focus-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-size: 13px; color: ${K.txt}; }
  .focus-setting-row > div { display: flex; align-items: center; gap: 9px; }
  .focus-setting-row b { min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; }
  .focus-step { width: 30px; height: 30px; border-radius: 9px; color: ${K.sub}; font-size: 17px; }
  .focus-setting-divider { height: 1px; background: ${K.border}; margin: 6px 0; }
  .focus-switch { width: 44px; height: 28px; border-radius: 14px; position: relative; }
  .focus-switch span { position: absolute; top: 2px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .18s ease; }
  .focus-support-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 760px; margin: 0 auto; }
  .focus-stat-card { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 10px; padding: 14px 16px; border-radius: 15px; background: ${GK.tintCard}; border: 1px solid ${GK.edge}; box-shadow: ${GK.shCard}; }
  .focus-stat-card span { color: ${K.sub}; font-size: 11px; }
  .focus-stat-card strong { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .focus-stat-card small { grid-column: 1 / -1; color: ${K.muted}; font-size: 10px; }
  .focus-history { margin-top: 22px; padding: 16px; border-radius: 16px; background: ${GK.tintSubtle}; border: 1px solid ${GK.edge}; }
  .focus-history-row { display: flex; align-items: center; gap: 9px; min-height: 38px; color: ${K.txt}; font-size: 12px; }
  .focus-history-row > span:first-child { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .focus-history-row > span:nth-child(2) { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .focus-history-row time { color: ${K.sub}; font-variant-numeric: tabular-nums; }
  @media (max-width: 640px) {
    .focus-inner { padding: 22px 14px 84px; }
    .focus-heading { align-items: center; flex-direction: row; }
    .focus-ambient-actions { justify-content: flex-start; width: 100%; }
    .focus-mini-action span { display: none; }
    .focus-mini-action { width: 40px; padding: 0; justify-content: center; }
    .focus-context-row { flex-direction: column; }
    .focus-phase-tabs { margin-bottom: 22px !important; }
    .focus-hero { padding-top: 6px; }
    .focus-hero > .gcard, .focus-hero-glow { width: min(78vw, 300px) !important; height: min(78vw, 300px) !important; }
    .focus-support-grid { grid-template-columns: 1fr; }
  }
  /* Short viewports — a phone held sideways, a split laptop window. Height,
     not width, is the constraint here: the dial is the tallest element, so it
     gives way first and everything else stays on screen. The ring svg is
     100% of its card (see the dial markup), so shrinking the card shrinks the
     ring with it instead of leaving it dangling. */
  @media (max-height: 760px) {
    .focus-hero > .gcard, .focus-hero-glow { width: min(78vw, 300px, 50vh) !important; height: min(78vw, 300px, 50vh) !important; }
    .focus-hero { margin-bottom: 14px !important; }
    .focus-dial.focus-dial { width: min(300px, 78vw, 44vh) !important; height: min(300px, 78vw, 44vh) !important; transform: none !important; }
    .focus-dial-row { margin-bottom: 14px !important; }
  }
  @media (prefers-reduced-motion: reduce) { .focus-orb { animation: none; } .focus-switch span { transition: none; } }
  /* Task rows: compact, one hairline between them, and a hover/​focus wash so
     the row reads as one target while the edit/delete affordances stay
     genuinely reachable (they are always rendered — never hover-only — and
     they darken on hover rather than appearing from nothing). */
  .task-row { border-radius: 10px; transition: background-color .14s ease; }
  @media (hover: hover) { .task-row:hover { background: ${GK.tintSubtle}; } }
  .task-row:focus-within { background: ${GK.tintSubtle}; }
  .task-act { opacity: .65; }
  @media (hover: hover) { .task-act:hover, .task-act:focus-visible { opacity: 1; } }
  .task-check:hover { border-color: ${K.ok} !important; }
  /* The chips and the row's actions are one block, so a narrow screen can
     move them as a unit. */
  .task-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  @media (max-width: 720px) { .task-cat { display: none; } }
  /* Handset: the title keeps the first line and the chips/actions drop to a
     second one. Keeping them on the same line collapsed the title to a
     handful of pixels, which made the row unreadable. */
  @media (max-width: 800px) {
    .task-row { flex-wrap: wrap; row-gap: 6px; }
    .task-main { flex: 1 1 60%; }
    .task-meta { flex: 1 1 100%; justify-content: flex-end; padding-left: 34px; }
  }

  /* Board columns: told apart by a tinted top rule and a faint well, not by
     wrapping each card in its own panel — the cards keep the page spacious. */
  .board-col {
    padding: 10px 10px 12px; border-radius: 14px;
    background: ${GK.tintSubtle}; border-left: 1px solid ${GK.edge};
    border-right: 1px solid ${GK.edge}; border-bottom: 1px solid ${GK.edge};
  }

  /* A pending request, shown as motion. Distinct from a static "Loading…"
     because it says the page is working rather than stuck; reduced motion
     swaps it for a pulsing dot with no rotation. */
  .north-spin {
    width: 13px; height: 13px; flex: 0 0 auto; border-radius: 50%;
    border: 2px solid ${K.border}; border-top-color: ${K.acc};
    display: inline-block; animation: northSpin .8s linear infinite;
  }
  @keyframes northSpin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .north-spin { animation: northPulse 1.4s ease-in-out infinite; border-top-color: ${K.border}; border-color: ${K.acc}; }
    @keyframes northPulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  }
  /* Text must stay readable wherever it sits on glass: the sheet material is
     the reading surface. */
  .gsheet, .gcard { color: ${K.txt}; }
  /* Interactive glass: a quiet lift on hover, instant press. */
  .ghov { transition: transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .2s ease, background-color .2s ease, border-color .2s ease; }
  @media (hover: hover) {
    .ghov:hover { transform: perspective(900px) translateY(-5px) rotateX(1.2deg) scale(1.01);
      box-shadow: inset 0 1px 0 ${GK.hi}, 0 24px 48px rgba(0,0,0,${K.dark ? ".30" : ".20"}), 0 5px 12px rgba(0,0,0,.10);
      border-color: ${K.dark ? "rgba(255,255,255,.18)" : "rgba(15,20,40,.14)"}; }
  }
  .ghov:active { transform: translateY(0) scale(.985); }
  /* Glass accent halo — restrained glow for the primary action. */
  .gacc { box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  /* Keyboard focus everywhere, including over glass. */
  .b:focus-visible, input:focus-visible, select:focus-visible, button:focus-visible {
    outline: 2px solid ${K.acc}; outline-offset: 2px; }
  /* Glass under reduced transparency: the same surfaces, made solid. */
  :root { color-scheme: ${K.dark ? "dark" : "light"}; }
  body { background: ${K.bg}; font-family: ${FONT}; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    button, input, select, textarea { font-family: inherit; }
    /* Press physics: instant feedback on pointer-down, settle on release.
       Springs (critically damped, no overshoot) ≈ cubic-bezier(.2,.8,.3,1). */
    .b { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
         cursor: pointer; text-align: center; line-height: inherit;
         transition: transform .12s cubic-bezier(.2,.8,.3,1), opacity .15s ease;
         -webkit-tap-highlight-color: transparent; will-change: transform; }
    .b:active { transform: scale(.955); }
    .b:disabled { cursor: default; }
    .b:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid ${K.acc}; outline-offset: 2px; border-radius: 6px; }
    ::selection { background: ${K.acc}30; }
    /* Page arrival: settle a hair upward with a quick fade — opacity +
       transform only, so it never paints layout. Reduced motion → no slide. */
    .pge { animation: pge .24s cubic-bezier(.2,.8,.3,1) both; }
    @keyframes pge { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    /* Respect OS motion + transparency preferences.
       Reduced motion swaps motion for plain opacity/color state changes,
       and stills the environment's breathing entirely. */
    @media (prefers-reduced-motion: reduce) {
      /* Replace motion with a short opacity-only cross-fade (skill §14). */
      .pge { animation: pgeFade .18s ease both; }
      @keyframes pgeFade { from { opacity: 0; } to { opacity: 1; } }
      .b { transition: opacity .1s ease; }
      .b:active { transform: none; }
      .ghov, .ghov:hover { transition: box-shadow .15s ease; transform: none; }
      .gsheet { animation: none !important; }
    }      /* Frosted chrome becomes solid when the OS asks for less transparency. */
    @media (prefers-reduced-transparency: reduce) { .mtrl, .gcard, .gsheet, .gsub { background: ${K.surf} !important; background-image: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } }
    @media (forced-colors: active) { .mtrl, .gcard, .gsheet, .gsub, .north-sidebar, .north-mobile-nav { background: Canvas !important; background-image: none !important; color: CanvasText !important; border: 1px solid CanvasText !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } }
    /* Custom-photo environment: the image is fixed wallpaper — it never
       scrolls with content — with the user's brightness/zoom/blur/position
       applied as CSS custom properties set inline by GLASS_ENV. */
    .envphoto {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background-image: var(--envPhoto);
      background-size: var(--envPhotoSize, cover);
      background-position: var(--envPos, 50% 50%);
      background-repeat: no-repeat;
      filter: brightness(var(--envBright, 1)) blur(var(--envBlur, 0px));
    }
    .envphoto::after {
      content: ""; position: absolute; inset: 0;
      background: rgba(8, 10, 16, var(--envDim, 0.35));
    }
    /* Built-in wallpaper. One fixed layer holding the ACTIVE environment's
       photograph (URL + scrim arrive as the --envWall/--envScrim custom
       properties GLASS_ENV sets inline), so the image never scrolls and only
       the selected environment is ever fetched. The scrim is a per-wallpaper
       gradient, not a flat rectangle: it thickens under the header and the
       dock and thins through the middle so the art stays visible. Nothing
       here animates or blurs. */
    .envwall {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background-image: var(--envWall);
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      background-color: ${ENVS[DEFAULT_ENV_ID].base};
    }
    .envwall::after {
      content: ""; position: absolute; inset: 0;
      background: var(--envScrim, rgba(8, 9, 12, 0.5));
    }
    /* Desktop hover: a quiet tint previews the press (web complements the
       touch-only press feedback with a hover state — skill §1/§10). */
    .nv:not([aria-current]):hover { background: ${K.border}55 !important; }
    .nv:not([aria-current]):active { transform: scale(.97); }

    .north-sidebar {
    position: fixed; inset: 0 auto 0 0; width: 208px; z-index: 25;
    display: none; flex-direction: column; padding: 22px 14px 18px;
    box-sizing: border-box; border-right: 1px solid ${GK.edge};
    /* Part of the room, not a slab dropped on top of it: the wallpaper reads
       through a light tint instead of being cut off at 208px. */
    background: rgba(255,255,255,.10);
    backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(140%);
    -webkit-backdrop-filter: blur(${GLASS.blurPrimary}px) saturate(140%);
  }
  @media (prefers-reduced-transparency: reduce) {
    .north-sidebar { background: rgba(255,255,255,.82); backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
  @media (prefers-reduced-motion: reduce) { .north-sidebar { backdrop-filter: none; } }
  .north-brand { display:flex; align-items:center; gap:10px; padding:0 10px 26px; }
  .north-nav { display:flex; flex-direction:column; gap:3px; }
  .north-nav-item { display:flex; align-items:center; gap:11px; width:100%; min-height:40px; padding:0 11px; border-radius:10px; color:${K.sub}; text-align:left; transition:background-color .16s ease, color .16s ease, transform .12s ease; }    .north-nav-item[aria-current="page"] { color:${K.txt}; background:${K.acc}1F; box-shadow: inset 2px 0 0 ${K.acc}; border-radius: 6px 10px 10px 6px; }
  .north-nav-item[aria-current="page"] svg { color:${K.acc}; }
  .north-nav-item:active { transform:scale(.985); }
  .north-sidebar-spacer { flex:1; }
  .north-account { display:flex; align-items:center; gap:10px; padding:10px; border-top:1px solid ${GK.edge}; margin-top:10px; color:${K.txt}; }
  /* The content column sits in the space to the RIGHT of the fixed sidebar —
     exactly once. The previous shell set both a 208px margin and a 208px
     padding here (and a max-width on top), so pages were centered against the
     whole viewport and then pushed right again, leaving a dead band of
     wallpaper on one side and content drifting toward the other. */
  .north-content { box-sizing: border-box; }
  /* ── PAGE MEASURE ──────────────────────────────────────────────────────
     One measure for every screen. 1060px is deliberately wider than the old
     900: with the sidebar eating 208px, 900 left a third of a laptop screen
     as bare wallpaper and squeezed real content (a 7-column calendar, three
     kanban columns) into a column that read as "tiny controls floating in the
     middle". It stays a fixed measure rather than full-bleed so line lengths
     and the calendar grid keep their proportions.
     It is CSS rather than an inline style so this one place controls the
     whole responsive frame: tighter gutters where screen is scarce, a wider
     but still bounded column where it is abundant. */
  .npage {
    padding: 28px 26px 8px; max-width: 1060px;
    margin: 0 auto; width: 100%; box-sizing: border-box;
  }
  @media (max-width: 640px) { .npage { padding: 20px 16px 8px; } }
  /* Very large display: a slightly wider column, still bounded so line lengths
     and the calendar keep their proportions. The Focus page has its own frame
     (.focus-inner) and follows the same measure so the two never disagree. */
  @media (min-width: 1700px) {
    .npage { max-width: 1200px; }
    .focus-inner { width: min(1200px, 100%) !important; }
  }
  /* ── TOUCH HIT AREAS ───────────────────────────────────────────────────
     A fingertip is ~40px, and this UI is legitimately dense: a 22px row
     icon, a 28px stepper, an inline "Today" link. Inflating those visually
     would wreck the rows they sit in, so the tappable box grows underneath
     them instead, through a transparent pseudo-element. Height-neutral: no
     layout moves, and the painted button stays exactly the same size. */
  @media (max-width: 820px) {
    .b { position: relative; }
    .b::after { content: ""; position: absolute; inset: -5px; }
    .b:disabled::after { content: none; }
  }
  /* Hide the header brand on desktop — it lives in the sidebar. */
  @media (min-width: 801px) { .mbrand { display:none !important; } }
  /* Desktop: the whole top bar steps aside — the sidebar carries brand,
     account and navigation; the right-click policy lives in Settings.
     Content centers in the space RIGHT of the sidebar (margin on the main
     itself; auto centering inside the remaining viewport width). */
  @media (min-width: 801px) {
    .nhead { display:none !important; }
    .north-content { margin-left:208px; width:calc(100% - 208px); }
  }
  @media (max-width: 800px) { .north-content { margin-left:0; width:100%; } }
  .north-nav-item:hover { color:${K.txt}; }
  .north-badge { min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:${K.err}; color:#fff; font-size:9.5px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
  .north-avatar { width:26px; height:26px; border-radius:8px; background:${K.acc}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; flex-shrink:0; }
  .north-un { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Desktop (≥801px): the sidebar IS the navigation; the floating dock
     steps aside. Mobile/tablet keeps the dock, hides the sidebar. */
  .ndock { }
  @media (min-width: 801px) {
    .north-sidebar { display:flex; }
    .ndock { display:none !important; }
  }
  @media (max-width: 800px) { .north-content { padding-left:0; } }
  .north-mobile-nav { display:none; }
  @media (max-width: 800px) {
    .north-sidebar { display:none; }
    .north-content { padding-left:0; }
    /* Full-bleed dock that WRAPS instead of a strip that scrolls: eight tabs
       in a single row of handsets either shrink past usability or hide
       destinations off the right edge. Two rows of four keep every tab
       visible and gives each one a real tap target. */
    .north-mobile-nav {
      display:flex; position:fixed; z-index:30;
      /* The desktop dock centers itself with inline "left:50%" + transform;
         on a handset it stretches edge to edge instead, so "important" is
         needed to win over those inline declarations. */
      left:10px !important; right:10px !important; bottom:10px; transform:none !important;
      max-width:none !important; overflow:visible !important; overflow-x:visible !important;
      flex-wrap:wrap; gap:3px; padding:5px;
      border-radius:16px; background:rgba(255,255,255,.12);
      border:1px solid ${GK.edge}; box-shadow:0 12px 34px rgba(0,0,0,.16);
    }
    .north-mobile-nav .nv { flex:1 1 calc(25% - 6px); min-width:0; padding:7px 4px 6px; }
    .north-mobile-nav .nv span { font-size:10.5px; }
  }
  @media (min-width: 801px) { .north-mobile-nav { display:none !important; } }
  /* Tablet / small-window width: seven tabs fit on ONE row, which is what
     keeps a tablet from reading as an oversized phone. Phones keep the 2x4
     grid above (real tap targets beat a cramped single row). */
  @media (min-width: 560px) and (max-width: 800px) {
    .north-mobile-nav .nv { flex: 1 1 calc(14.2857% - 6px); }
    .north-mobile-nav .nv span { font-size: 11px; }
  }
  @media (prefers-reduced-transparency: reduce) { .north-sidebar, .north-mobile-nav { background:rgba(255,255,255,.84); } }
  `}</style>
);

// ══════════════════════════════════════════════════════════════════════════
// THEME SWITCH
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
// Credentials are Supabase's job; this component never builds a user object.
// It validates input, calls the account service, and hands the Supabase user
// up to App, which maps it once through the shared `toAppUser` (that single
// mapper is what keeps the same person on the same key on every device).
//
// Until this device has real Supabase credentials (.env.local still holds the
// placeholder values), `supabase` is null. Saying so beats throwing: the rest
// of the app is fully usable without an account service.
const NO_ACCOUNTS =
  "Account service isn't set up yet. Add your Supabase project URL and anon key to react-app/.env.local (see SETUP.md), then restart the dev server.";

// Pacing for the "resend confirmation email" button, in seconds. This is a UI
// timer ONLY: Supabase's own email rate limit is longer, is enforced by the
// service, and reports itself through an error we surface verbatim. The copy
// around this number must never claim otherwise.
const RESEND_WAIT = 5;

/**
 * One auth text field.
 *
 * Defined at MODULE scope deliberately. A component created inside `Auth` is a
 * different function on every render, so React compares element types, sees a
 * new one, and unmounts + remounts the whole subtree — destroying the <input>
 * DOM node and dropping the caret. That is precisely what made these fields
 * lose focus after a single character. A stable component type keeps one DOM
 * node per field, so typing stays continuous.
 */
const AuthField = ({ ph, t = "text", autoComplete, value, onChange, onEnter, reveal, onToggleReveal }) => (
  <div style={{ position: "relative" }}>
    <input type={t === "password" && reveal ? "text" : t}
      placeholder={ph}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
      style={{ ...inpSt(), paddingRight: t === "password" ? 40 : 12 }} />
    {t === "password" && (
      <button type="button" className="b" onClick={onToggleReveal}
        aria-pressed={!!reveal} aria-label={reveal ? "Hide password" : "Show password"}
        title={reveal ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: K.sub }}>
        {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    )}
  </div>
);

function Auth({ noAccount, onDismissNoAccount, envId, envPhoto, extensionConnectStatus, onDismissExtensionStatus }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [f, setF] = useState({ pass: "", name: "", email: "", userTouched: false });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const [passVisible, setPassVisible] = useState(false);
  // Address the confirmation email was sent to, plus the resend pacing timer.
  // Kept as plain state: it is a view concern, and nothing here is ever written
  // to storage or to the account record.
  const [sentTo, setSentTo] = useState("");
  // Wall-clock deadline rather than a decremented counter — same rule the Focus
  // timer follows. A countdown that counts its own ticks drifts (background
  // tabs throttle timers), so the number shown is always derived from the clock.
  const [resendAt, setResendAt] = useState(0);
  const [, bumpClock] = useState(0);
  const cooldown = resendAt ? Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)) : 0;
  const waiting = cooldown > 0;

  const togglePassVisible = () => setPassVisible(!passVisible);
  const armResend = () => setResendAt(Date.now() + RESEND_WAIT * 1000);

  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(() => bumpClock((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [waiting]);

  // No username is collected or guessed here: the shared mapper derives it
  // from the email (or the account id) so it is identical on every device.
  const switchMode = (m) => {
    setMode(m);
    setErr("");
    setInfo("");
    onDismissNoAccount?.();
  };

  const submit = async () => {
    // Enter inside a field calls this directly and bypasses the disabled button,
    // so the guard has to live here too or a held key could fire the request
    // repeatedly. Sign-in and sign-up both pass through this one check.
    if (busy) return;
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); setInfo(""); return; }
    setBusy(true); setErr(""); setInfo("");
    if (mode === "login") {
      if (!f.email || !f.pass) { setErr("Email and password required."); setBusy(false); return; }
      const { error } = await supabase.auth.signInWithPassword({
        email: f.email,
        password: f.pass,
      });
      if (error) { setErr(error.message); setBusy(false); return; }
      // App's auth-state subscription owns account adoption. Keeping one
      // authority avoids password sign-in racing the SIGNED_IN event.
    } else {
      if (!f.name || !f.email || !f.pass) { setErr("Fill in every field."); setBusy(false); return; }
      const { data, error } = await supabase.auth.signUp({
        email: f.email,
        password: f.pass,
        // Carried as metadata so `toAppUser` can name the profile without
        // asking the user twice on any client.
        options: { data: { name: f.name.trim() } }
      });
      if (error) { setErr(error.message); setBusy(false); return; }
      if (data?.session?.user) {
        // Confirmation is switched off on this project → we are already signed
        // in. App's SIGNED_IN listener creates and loads the profile.
        return;
      }
      setSentTo(f.email.trim());
      armResend();
      setBusy(false);
    }
  };

  /**
   * Start a real password reset. Supabase sends the email and enforces its own
   * rate limit; the link returns to this app, where the PASSWORD_RECOVERY
   * session is turned into the set-a-new-password screen (see `SetPassword`).
   * The copy never says "reset functionality will be configured" — it either
   * sends the mail or shows the service's own error.
   */
  const sendReset = async () => {
    if (busy) return;
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); setInfo(""); return; }
    const email = f.email.trim();
    if (!email) { setErr("Enter your email address first, then choose Forgot password?"); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      // Deliberately the same message whether or not the address is registered:
      // telling an anonymous visitor which emails have accounts is an account
      // enumeration leak, and Supabase's own API does not distinguish either.
      if (error) setErr(error.message);
      else setInfo(`If an account exists for ${email}, a reset link is on its way.`);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Google sign-in / sign-up. The OAuth redirect leaves this page entirely;
   * supabase-js detects the session in the URL on return (detectSessionInUrl)
   * and App's boot `getSession()` adopts it through `adoptAccount`.
   *
   * INTENT: the tab the button sits on decides the semantics. "Sign in with
   * Google" is for existing accounts only — if the provider returns a
   * brand-new account, App signs the session back out and this screen shows
   * the `noAccount` state pointing at Sign up. From the Sign up tab the same
   * provider click creates/links the North account, which is the point.
   *
   * The intent survives the redirect in a session-storage note (survives the
   * round trip, dies with the tab) and is read by the boot path.
   *
   * `redirectTo` must be listed in the dashboard's redirect allow-list, or
   * Supabase refuses the flow with an error shown below, unchanged.
   */
  const signInWithGoogle = async () => {
    if (busy) return;
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); setInfo(""); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      try { sessionStorage.setItem("north:oauth-intent", mode === "register" ? "signup" : "signin"); } catch {}
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      // On success the browser navigates away, so an error here is the only
      // path that returns. A project without the Google provider enabled is
      // the common one — say what to do, not just what failed.
      if (error) {
        try { sessionStorage.removeItem("north:oauth-intent"); } catch {}
        setErr(
          /provider|unsupported|invalid/i.test(error.message || "")
            ? "Google sign-in isn't enabled on this project yet. Enable the Google provider in Supabase → Authentication → Providers (see SETUP.md)."
            : error.message
        );
        setBusy(false);
      }
      // No setBusy(false) on success: the page is navigating away.
    } catch (e) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  /**
   * Resend the confirmation email. The countdown paces this screen only —
   * Supabase enforces its own, longer limit and answers with a real error when
   * it is reached, which is shown to the person unchanged. Nothing is retried
   * automatically, so this can never turn into a mail-bomb.
   */
  const resend = async () => {
    if (busy || waiting || !sentTo) return;
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: sentTo });
      if (error) setErr(error.message);
      else setInfo(`Confirmation email sent again to ${sentTo}.`);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      // Re-arm either way: a refusal from the service is a reason to wait, not
      // a reason to try again immediately.
      setBusy(false);
      armResend();
    }
  };

  return (
    <div style={{
      ...GLASS_ENV(envId, envPhoto),
      position: "relative", minHeight: "100vh",
      display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: FONT,
    }} className="genv">
      {ENV_WALL_LAYER(envId)}
      {ENV_PHOTO_LAYER(envId, envPhoto)}
      {G()}

      {/* Floating glass sheet — the Auth screen's one primary surface. The
          material comes from .gsheet (lens, specular edge, float shadow);
          presentation rises softly like a sheet being summoned. */}
      <div className="gsheet" style={{
        width: "100%", maxWidth: 400, borderRadius: 24,
        padding: "30px 28px",
        animation: "gsheetIn .38s cubic-bezier(.2,.8,.3,1) both",
      }}>        {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <img src="/north-logo.png" alt="" width="38" height="38" style={{ objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: K.txt, letterSpacing: -0.3 }}>NORTH</div>
            <div style={{ fontSize: 11, color: K.sub }}>Focus · Plan · Win your day</div>
          </div>
        </div>

      {extensionConnectStatus && (
          <div role={extensionConnectStatus.kind === "error" ? "alert" : "status"} style={{
            marginBottom: 14, borderRadius: 10, padding: "10px 12px", fontSize: 12,
            lineHeight: 1.5, color: extensionConnectStatus.kind === "error" ? K.err : K.txt,
            background: extensionConnectStatus.kind === "error" ? `${K.err}18` : K.accDim,
            border: `1px solid ${extensionConnectStatus.kind === "error" ? `${K.err}44` : `${K.acc}44`}`,
            display: "flex", alignItems: "flex-start", gap: 9,
          }}>
            <img src="/north-logo.png" alt="" width="20" height="20" style={{ objectFit: "contain", flex: "0 0 auto" }} />
            <span style={{ flex: 1 }}>{extensionConnectStatus.message}</span>
            <button type="button" className="b" onClick={onDismissExtensionStatus} aria-label="Dismiss message" title="Dismiss" style={{ color: K.txt, padding: 2 }}><X size={15} /></button>
          </div>
        )}

        {/* Log in / Sign up */}
        <div role="tablist" aria-label="Log in or create an account" className="gsub"
          style={{ display: "flex", padding: 3, marginBottom: 18 }}>
          {[["login", "Log in"], ["register", "Sign up"]].map(([id, lbl]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} className="b"
              onClick={() => switchMode(id)}
              style={{
                flex: 1, textAlign: "center", padding: 8, borderRadius: 8,
                background: mode === id ? GK.tintCard : "transparent",
                color: mode === id ? K.txt : K.sub, fontSize: 13, fontWeight: 600,
                boxShadow: mode === id ? `inset 0 1px 0 ${GK.hi}, 0 1px 4px rgba(0,0,0,.10)` : "none",
                transition: "all .2s",
              }}>{lbl}</button>
          ))}
        </div>

        {/* A brand-new Google account arrived via the sign-in tab. The session
            has been signed out; explain plainly and route to Sign up. */}
        {noAccount ? (
          <>
            <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: K.txt, letterSpacing: -0.4 }}>No North account found</h1>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: K.sub, lineHeight: 1.6 }}>
              {noAccount.email
                ? <><strong style={{ color: K.txt }}>{noAccount.email}</strong> doesn't have a North account yet.</>
                : "This Google account doesn't have a North account yet."}{" "}
              Please use Sign up first — it takes one tap with Google.
            </p>
            <button type="button" className="b" onClick={() => { onDismissNoAccount?.(); switchMode("register"); }}
              style={{
                marginTop: 4, padding: 13, borderRadius: 10, width: "100%",
                background: K.acc, color: K.onAcc, fontWeight: 600, fontSize: 14,
              }}>
              Go to Sign up
            </button>
            <button type="button" className="b" onClick={() => { onDismissNoAccount?.(); switchMode("login"); }}
              style={{ marginTop: 10, width: "100%", padding: 8, fontSize: 12, color: K.sub }}>
              Back to log in
            </button>
          </>
        ) : mode === "login" ? (
          <>
            <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: K.txt, letterSpacing: -0.4 }}>Welcome back</h1>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: K.sub }}>Log in with your email and password.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <AuthField ph="Email" t="email" autoComplete="email"
                value={f.email} onChange={(v) => setF((x) => ({ ...x, email: v }))}
                onEnter={submit} />
              <AuthField ph="Password" t="password" autoComplete="current-password"
                value={f.pass} onChange={(v) => setF((x) => ({ ...x, pass: v }))}
                onEnter={submit} reveal={passVisible} onToggleReveal={togglePassVisible} />
            </div>
            {/* Only a real control lives here. The previous "Remember me" box
                was never read by anything, so it was removed rather than left
                looking like it did something; the Supabase session is already
                persisted for this device and the Sign out button ends it. */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, fontSize: 12 }}>
              <button type="button" className="b" onClick={sendReset} disabled={busy}
                style={{ color: K.acc, opacity: busy ? 0.6 : 1 }}>Forgot password?</button>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: K.txt, letterSpacing: -0.4 }}>Create your account</h1>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: K.sub }}>Use your email and a password — that's all NORTH needs.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <AuthField ph="Full name" autoComplete="name"
                value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))}
                onEnter={submit} />
              <AuthField ph="Email" t="email" autoComplete="email"
                value={f.email} onChange={(v) => setF((x) => ({ ...x, email: v }))}
                onEnter={submit} />
              <AuthField ph="Password" t="password" autoComplete="new-password"
                value={f.pass} onChange={(v) => setF((x) => ({ ...x, pass: v }))}
                onEnter={submit} reveal={passVisible} onToggleReveal={togglePassVisible} />
            </div>
          </>
        )}

        {sentTo && (
          <div style={{ marginTop: 12, borderRadius: 10, background: K.surf, border: `1px solid ${K.border}`, padding: "10px 11px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: K.txt }}>Confirm your email</div>
            <div style={{ fontSize: 11, color: K.sub, marginTop: 3, lineHeight: 1.55 }}>
              A confirmation link is on its way to <strong style={{ color: K.txt }}>{sentTo}</strong>.
              Open it, then log in.
            </div>
            <button type="button" className="b" onClick={resend}
              disabled={busy || waiting}
              aria-live="polite" aria-disabled={busy || waiting}
              style={{
                marginTop: 8, padding: "7px 11px", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                background: busy || waiting ? K.surf : K.acc,
                border: `1px solid ${busy || waiting ? K.border : K.acc}`,
                color: busy || waiting ? K.muted : "#fff",
              }}>
              {waiting ? `Resend available in ${cooldown}s` : "Resend confirmation email"}
            </button>
            <p style={{ fontSize: 10, color: K.muted, margin: "7px 0 0", lineHeight: 1.5 }}>
              This {RESEND_WAIT}-second timer only paces this screen. Supabase's own email
              limit is longer, and if it is reached the service's message is shown above
              rather than hidden.
            </p>
          </div>
        )}
        {info && <div role="status" style={{ fontSize: 11.5, color: K.acc, background: K.accDim, borderRadius: 8, padding: "8px 10px", marginTop: 10, lineHeight: 1.5 }}>{info}</div>}
        {err && <div role="alert" style={{ color: K.err, fontSize: 12, marginTop: 10 }}>{err}</div>}

        <button type="button" className="b" onClick={submit} disabled={busy}
          style={{
            marginTop: 16, padding: 13, borderRadius: 10, width: "100%",
            background: K.acc, color: K.onAcc, fontWeight: 600, fontSize: 14,
            opacity: busy ? 0.7 : 1, transition: "opacity .2s",
          }}>
          {busy ? "···" : mode === "login" ? "Log in" : "Create account"}
        </button>

        {/* Google sign-in. Same flow for both tabs — a provider is neither a
            login nor a signup, it is whichever the account already is. */}
        <div role="separator" aria-label="or" style={{
          display: "flex", alignItems: "center", gap: 10, margin: "14px 0 0",
          color: K.muted, fontSize: 10.5, letterSpacing: 0.6,
        }}>
          <span style={{ flex: 1, height: 1, background: K.border }} /> OR <span style={{ flex: 1, height: 1, background: K.border }} />
        </div>
        <button type="button" className="b" onClick={signInWithGoogle} disabled={busy}
          aria-label="Continue with Google"
          style={{
            marginTop: 12, padding: 12, borderRadius: 12, width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: GK.tintSubtle, border: `1px solid ${GK.edge}`,
            boxShadow: `inset 0 1px 0 ${GK.hi}`,
            color: K.txt, fontWeight: 600, fontSize: 13.5,
            opacity: busy ? 0.6 : 1, transition: "opacity .2s",
          }}>
          <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" />
            <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.2v5.7C7.8 41 15.3 46 24 46z" />
            <path fill="#FBBC05" d="M11.6 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.2C2.7 17.1 1.9 20.4 1.9 24s.8 6.9 2.3 9.9l7.4-5.7z" />
            <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.2 30 2 24 2 15.3 2 7.8 7 4.2 14.1l7.4 5.7c1.7-5.2 6.6-9.1 12.4-9.1z" />
          </svg>
          Continue with Google
        </button>

        {/* Tell the truth about where the data goes: with a configured project
            every write is mirrored to the account and pulled back on the next
            device, so the old "stays on this device" line is no longer true. */}
        <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 10.5, color: K.muted, lineHeight: 1.5 }}>
          {supabaseConfigured
            ? "Your tasks and focus history sync to your account — sign in on any NORTH client and they're there."
            : "Accounts aren't configured on this deployment, so your data stays on this device."}
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SET A NEW PASSWORD (the second half of a password reset)
// ══════════════════════════════════════════════════════════════════════════
// The reset email links back to this app. Supabase parses the recovery token
// out of the URL and signs the person in with a PASSWORD_RECOVERY session, which
// App turns into this screen. Without it the reset link would drop the user into
// the normal app with no way to actually choose a password.
const MIN_PASSWORD = 8;

function SetPassword({ onDone, envId, envPhoto }) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (pass.length < MIN_PASSWORD) { setErr(`Use at least ${MIN_PASSWORD} characters.`); return; }
    if (pass !== confirm) { setErr("Both passwords must match."); return; }
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); return; }
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password: pass });
      if (error) setErr(error.message);
      else onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      ...GLASS_ENV(envId, envPhoto),
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: FONT,
    }} className="genv">
      {ENV_WALL_LAYER(envId)}
      {ENV_PHOTO_LAYER(envId, envPhoto)}
      {G()}
      <div className="gsheet" style={{
        width: "100%", maxWidth: 400, borderRadius: 24, padding: "30px 28px",
        animation: "gsheetIn .38s cubic-bezier(.2,.8,.3,1) both",
      }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: K.txt, letterSpacing: -0.4 }}>
          Choose a new password
        </h1>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: K.sub }}>
          You're verified — set the password you'll use from now on.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <AuthField ph={`New password (${MIN_PASSWORD}+ characters)`} t="password" autoComplete="new-password"
            value={pass} onChange={setPass} onEnter={submit}
            reveal={reveal} onToggleReveal={() => setReveal((v) => !v)} />
          <AuthField ph="Repeat new password" t="password" autoComplete="new-password"
            value={confirm} onChange={setConfirm} onEnter={submit}
            reveal={reveal} onToggleReveal={() => setReveal((v) => !v)} />
        </div>
        {err && <div role="alert" style={{ color: K.err, fontSize: 12, marginTop: 10 }}>{err}</div>}
        <button type="button" className="b" onClick={submit} disabled={busy}
          style={{
            marginTop: 16, padding: 13, borderRadius: 10, width: "100%",
            background: K.acc, color: K.onAcc, fontWeight: 600, fontSize: 14,
            opacity: busy ? 0.7 : 1,
          }}>
          {busy ? "···" : "Save password"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════════════
const PCOL = () => ({ low: K.ok, medium: K.warn, high: K.err });

function Home({ user, go }) {
  const [stats, setStats] = useState({ fm: 0, done: 0, total: 0, streak: 0, sessions: 0, lifeMin: 0, lifeSessions: 0 });

  useEffect(() => {
    Promise.all([
      S.get(`fo:${user.un}:${today()}`),
      S.get(`u:${user.un}`),
      S.get(`lb:${user.un}`, true),
    ]).then(([fd, u, lb]) => {
      const tasks = u?.tasks || [];
      setStats((s) => ({
        ...s,
        fm:     fd ? Math.floor(fd.s / 60) : 0,
        done:   tasks.filter((t) => t.completed && t.due === today()).length,
        total:  tasks.filter((t) => t.due === today()).length,
        // Lifetime totals come from the LEADERBOARD aggregate the server
        // computes from recorded focus sessions (`fm` = focus minutes) — the
        // same data the Social screen ranks on — never from a local counter.
        lifeMin: lb?.fm || 0,
        streak: lb?.streak || 0,
        sessions: Array.isArray(u?.fs) ? u.fs.length : 0,
      }));
    });
    // Today's raw session records for the day view.
    S.get(`fs:${user.un}:${today()}`).then((recs) => {
      if (Array.isArray(recs)) setStats((s) => ({ ...s, sessions: recs.length }));
    });
  }, [user.id, user.un]);

  const h     = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  // The unified day view: tasks, events, overdue, completed — one model.
  const dv = dayView(user.tasks, [], { minutes: stats.fm, sessions: stats.sessions }, today());

  return (
    <div className="npage">
      {/* Greeting */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 13.5, color: K.sub, letterSpacing: 0.1 }}>{greet},</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: K.txt, marginTop: 3, letterSpacing: "-0.02em" }}>
          {user.name} 👋
        </div>
      </div>

      {/* The three big stat cards are gone. The same real numbers — today's
          focused minutes, today's task progress, the leaderboard streak —
          stated in one line instead of taking a third of the viewport. Each
          fact only appears when it is actually non-zero, so a new account is
          never dressed up with zeros. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginBottom: 22, fontSize: 14, color: K.sub, lineHeight: 1.5 }}>
        {[
          { k: "f", v: `${stats.fm}m`, t: "focused today" },
          stats.total > 0 ? { k: "t", v: `${stats.done}/${stats.total}`, t: "tasks today" } : null,
          stats.streak > 0 ? { k: "s", v: `${stats.streak}d`, t: "streak" } : null,
          stats.sessions > 0 ? { k: "n", v: String(stats.sessions), t: stats.sessions === 1 ? "session" : "sessions" } : null,
          // Lifetime productivity, from the same server aggregate the
          // leaderboard ranks on. One line, still no wall of cards.
          stats.lifeMin > 0
            ? { k: "lf", v: stats.lifeMin >= 60 ? `${Math.floor(stats.lifeMin / 60)}h${stats.lifeMin % 60 ? ` ${stats.lifeMin % 60}m` : ""}` : `${stats.lifeMin}m`, t: "focused in total" }
            : null,
        ].filter(Boolean).map((s, i) => (
          <span key={s.k} style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
            {i > 0 && <span aria-hidden="true" style={{ color: K.muted }}>·</span>}
            <span>
              <b style={{ color: K.txt, fontWeight: 700, fontSize: 15.5, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{s.v}</b> {s.t}
            </span>
          </span>
        ))}
      </div>

      {/* Quick start — the primary glass surface: translucent accent material
          with a specular edge, and the play control as lit glass, not a flat
          blue rectangle. */}
      <button type="button" className="b ghov" onClick={() => go("focus")}
        aria-label="Start a focus session"
        style={{
          ...card(), marginBottom: 26, width: "100%", textAlign: "left", borderRadius: 18,
          background: `linear-gradient(${GK.lumA}, ${GK.lumB}), ${K.acc}26`,
          border: `1px solid ${K.acc}45`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,${K.dark ? ".22" : ".65"}), inset 0 0 24px ${K.acc}14, 0 10px 32px -12px ${K.acc}45`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 18, fontWeight: 680, color: K.txt, letterSpacing: "-0.015em" }}>Start focus session</span>
          <span style={{ fontSize: 12.5, color: K.sub }}>{user.pm?.w || 25} min · Pomodoro</span>
        </span>
        <span className="gacc" style={{
          width: 52, height: 52, borderRadius: 17, flexShrink: 0,
          background: `linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,0) 45%), ${K.acc}`,
          color: K.onAcc,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 4px 14px ${K.acc}55, inset 0 1px 0 rgba(255,255,255,.4)`,
        }}><Play size={21} color={K.onAcc} fill={K.onAcc} /></span>
      </button>

      {/* Unified day view — tasks · events · overdue · completed, one calm list. */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ ...sectionTitle() }}>Today</div>
          <button type="button" className="b" onClick={() => go("calendar")}
            style={{ fontSize: 12, color: K.acc, padding: "4px 2px" }}>Calendar →</button>
        </div>
        {dv.overdue.length > 0 && (
          <div style={{ ...card2(), display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", marginBottom: 8, border: `1px solid ${K.err}30` }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: K.err, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: K.err, fontWeight: 600 }}>
              {dv.overdue.length} overdue task{dv.overdue.length === 1 ? "" : "s"}
            </span>
            <span style={{ fontSize: 11.5, color: K.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {dv.overdue.slice(0, 2).map((t) => t.title).join(", ")}{dv.overdue.length > 2 ? ` +${dv.overdue.length - 2}` : ""}
            </span>
          </div>
        )}
        {dv.overdue.length === 0 && dv.next.length === 0 && dv.completed.length === 0 ? (
          <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 13 }}>
            ✓ All clear for today
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dv.next.slice(0, 5).map((item) => (
              <div key={`${item.type}:${item.id}`} style={{ ...card2(), display: "flex", alignItems: "center", gap: 10 }}>
                {item.type === "event" ? (
                  <span aria-hidden="true" style={{ width: 3, height: 24, borderRadius: 2, background: K.warn, flexShrink: 0 }} />
                ) : (
                  <span aria-hidden="true" style={{ width: 3, height: 24, borderRadius: 2, background: PCOL()[item.pri] || K.acc, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, fontSize: 13, color: K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                {item.type === "event" ? (
                  <>
                    <span style={{ fontSize: 10.5, color: K.muted, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{item.allDay ? "All day" : eventTimeLabel({ ...item, start: item.at, end: item.at + 3600000, allDay: false }).split("–")[0]}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: K.warn, flexShrink: 0 }}>GOOGLE</span>
                  </>
                ) : (
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: K.acc, flexShrink: 0 }}>TASK</span>
                )}
              </div>
            ))}
            {dv.completed.length > 0 && (
              <div style={{ ...card2(), display: "flex", alignItems: "center", gap: 10, opacity: 0.7 }}>
                <Check size={14} color={K.ok} aria-hidden="true" />
                <span style={{ fontSize: 12.5, color: K.muted }}>
                  {dv.completed.length} completed today
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activity heatmap — built from recorded focus sessions */}
      <div style={{ marginTop: 26 }}>
        <ActivityMap user={user} />
      </div>

      {/* Analytics — every number from real recorded sessions (lib/analytics). */}
      <AnalyticsPanel user={user} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ANALYTICS PANEL — a quiet summary, not a dashboard
// ══════════════════════════════════════════════════════════════════════════
function AnalyticsPanel({ user }) {
  const [a, setA] = useState(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      // Gather the 4-week window of real session records from the store.
      const byDay = {};
      await Promise.all(Array.from({ length: 28 }, (_, i) => {
        const d = new Date(Date.now() - i * 86400000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return S.get(`fs:${user.un}:${key}`).then((recs) => { if (Array.isArray(recs) && recs.length) byDay[key] = recs; });
      }));
      if (!dead) setA(analyticsSummary(byDay, user.tasks, Date.now()));
    })();
    return () => { dead = true; };
  }, [user.un, user.tasks]);

  if (!a) return null;
  const trend = a.weekTrend.changePct === null ? "" : a.weekTrend.changePct >= 0 ? `+${a.weekTrend.changePct}% vs last week` : `${a.weekTrend.changePct}% vs last week`;

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: K.txt }}>Last 4 weeks</div>
        {trend && <div style={{ fontSize: 11, color: a.weekTrend.changePct >= 0 ? K.ok : K.warn }}>{trend}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[
          { lbl: "FOCUS TIME", val: `${a.totals.focusMinutes}m` },
          { lbl: "SESSIONS",   val: a.totals.sessions },
          { lbl: "ACTIVE DAYS", val: a.totals.activeDays },
          { lbl: "TASKS DONE", val: a.tasks.completed },
        ].map((s) => (
          <div key={s.lbl} style={{ ...card(), textAlign: "center", padding: "12px 8px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: K.txt, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
            <div style={{ fontSize: 9, color: K.sub, marginTop: 3, letterSpacing: 0.5 }}>{s.lbl}</div>
          </div>
        ))}
      </div>      {a.topTasks.length > 0 && (
        <div style={{ ...card(), marginTop: 10, padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: K.sub, letterSpacing: 0.6, marginBottom: 6 }}>MOST FOCUSED TASKS</div>
          {a.topTasks.slice(0, 3).map((t, i) => (
            <div key={t.taskId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: i < Math.min(2, a.topTasks.length - 1) ? `1px solid ${K.border}` : "none" }}>
              <span style={{ fontSize: 12, color: K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 10 }}>{t.title}</span>
              <span style={{ fontSize: 11.5, color: K.sub, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{t.minutes}m · {t.sessions}×</span>
            </div>
          ))}
        </div>
      )}
      <DistractionStrip user={user} />
    </div>

  );
}

/**
 * One quiet line of blocking insight under the analytics panel: browsing time
 * the extension recorded on domains this account blocks. Data comes from the
 * same `usage_records` table the extension uploads to (owner-scoped, RLS);
 * domains and minutes only — never paths or page content. Absent data simply
 * renders nothing (the extension may not be installed, or may not be signed
 * in) — never a placeholder pretending to be a measurement.
 */
function DistractionStrip({ user }) {
  const [d, setD] = useState(null);
  const hiddenSites = useRef(Array.isArray(user.hiddenUsageSites) ? user.hiddenUsageSites : []);
  useEffect(() => {
    let dead = false;
    setD(null);
    const readHistory = async () => {
      if (!supabaseConfigured || !supabase) return;
      try {
        const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
        const [{ data: rows, error }, { data: prof }] = await Promise.all([
          supabase.from("usage_records")
            .select("day, name, seconds")
            .eq("kind", "website")
            .gte("day", since),
          supabase.from("profiles").select("settings").eq("id", user.id ?? (await S.get(`u:${user.un}`))?.id).maybeSingle(),
        ]);
        if (dead || error) return;
        const rules = prof?.settings?.blocking?.rules || [];
        hiddenSites.current = Array.isArray(prof?.settings?.hiddenUsageSites) ? prof.settings.hiddenUsageSites : hiddenSites.current;
        const summary = distractionSummary(rows || [], rules, new Date().toISOString().slice(0, 10), hiddenSites.current);
        if (!dead) setD((prev) => ({ ...prev, ...summary }));
        readLive();
      } catch { /* offline / table not migrated yet → render local totals only */ }
    };
    const readLive = async () => {
      const extension = await readExtensionUsage();
      if (!dead) setD((prev) => ({
        ...(prev || { available: false, totalMinutes: 0, blockedMinutes: 0, topDomains: [] }),
        installed: Boolean(extension.installed),
        today: extension.installed ? (extension.usageToday || []).filter((entry) => !isHiddenUsageSite(entry.host, hiddenSites.current)) : [],
        blockedToday: extension.installed ? extension.blockedToday || [] : [],
      }));
    };
    readHistory();
    readLive();
    const onVisible = () => { if (document.visibilityState === "visible") readLive(); };
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60000);
    return () => {
      dead = true;
      clearInterval(timer);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user.id, user.un]);

  const todayMinutes = Math.round((d?.today || []).reduce((n, e) => n + (Number(e.seconds) || Number(e.minutes) * 60 || 0), 0) / 60);
  const blockedAttempts = (d?.blockedToday || []).reduce((n, e) => n + (Number(e.count) || 0), 0);
  if (!d || (!d.totalMinutes && !todayMinutes && !d.installed)) return null;
  return (
    <div style={{ ...card(), marginTop: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: K.sub, letterSpacing: 0.6, marginBottom: 6 }}>BROWSING · THIS BROWSER</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: K.txt }}>
          {d.totalMinutes > 0 && d.blockedMinutes > 0
            ? `${d.blockedMinutes} of ${d.totalMinutes} minutes went to blocked domains`
            : d.totalMinutes > 0 ? `${d.totalMinutes} minutes tracked in the last 4 weeks` : `Today · ${todayMinutes}m tracked`}
        </span>
        <span style={{ fontSize: 10.5, color: K.muted, flexShrink: 0 }}>{d.installed ? `Today ${todayMinutes}m` : "extension not detected"}</span>
      </div>
      {(d.today || []).length > 0 && (
        <div style={{ fontSize: 11, color: K.muted, marginTop: 4 }}>
          Today: {d.today.slice(0, 3).map((e) => `${e.host} (${e.minutes ?? Math.round((e.seconds || 0) / 60)}m)`).join(" · ")}
        </div>
      )}
      {d.topDomains.length > 0 && (
        <div style={{ fontSize: 11, color: K.muted, marginTop: 4 }}>
          Top: {d.topDomains.slice(0, 3).map((t) => `${t.domain} (${t.minutes}m)`).join(" · ")}
        </div>
      )}
      {blockedAttempts > 0 && <div style={{ fontSize: 11, color: K.sub, marginTop: 4 }}>{blockedAttempts} blocked attempts today</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVITY HEATMAP
// ══════════════════════════════════════════════════════════════════════════
// GitHub-style focus map over the last 26 weeks (half a year), fed only by
// the recorded daily totals (`fo:<user>:<date>`), so every lit cell is real
// focused time. Levels are minutes/day; the legend states the thresholds so
// the colours can be read without guessing.
const MAP_WKS = 26;
const MAP_AL  = ["3D", "6B", "94", "BC", "E6"]; // accent alpha steps, low → high (wide spread so quiet vs strong days read instantly)
const HM_LVL  = (min) => min <= 0 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 50 ? 3 : min < 80 ? 4 : 5;
const HM_LBL  = ["0", "15m", "30m", "50m", "80m+"].map((s, i) => (i === 0 ? "none" : s));
const HM_DOW  = ["M", "", "W", "", "F", "", ""];
const ymdOf   = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function ActivityMap({ user }) {
  const [mins, setMins] = useState(null); // Map "YYYY-MM-DD" → focused minutes
  const td = today();

  useEffect(() => {
    let dead = false;
    (async () => {
      // Align the grid to this week's Monday, then walk back MAP_WKS weeks.
      const now = new Date();
      const wk  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
      const start = new Date(wk);
      start.setDate(start.getDate() - (MAP_WKS - 1) * 7);

      const keys = [];
      for (let i = 0; i < MAP_WKS * 7; i++) keys.push(ymdOf(new Date(start.getTime() + i * 86400000)));
      const vals = await Promise.all(keys.map((k) => S.get(`fo:${user.un}:${k}`)));
      const map  = new Map();
      keys.forEach((k, i) => { const s = vals[i]?.s || 0; if (s > 0) map.set(k, Math.max(1, Math.round(s / 60))); });
      if (!dead) setMins(map);
    })();
    return () => { dead = true; };
  }, [user.un]);

  const now = new Date();
  const wk  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
  const start = new Date(wk);
  start.setDate(start.getDate() - (MAP_WKS - 1) * 7);

  // Columns are weeks (Mon…Sun); a column gets a month label when that
  // month's 1st lands inside it (and the leading column always does).
  const cols  = Array.from({ length: MAP_WKS }, (_, w) =>
    Array.from({ length: 7 }, (_, r) => {
      const d = new Date(start.getTime() + (w * 7 + r) * 86400000);
      return { d, ymd: ymdOf(d) };
    })
  );
  const monthAt = (w) => w === 0 || cols[w].some(({ d }) => d.getDate() === 1);

  // Trailing-4-weeks summary for the header (minutes → compact h/m).
  // Header total spans the whole map window (MAP_WKS weeks), matching what
  // is actually drawn — it used to say "last 4 weeks" over a 16-week grid.
  let sumAll = 0;
  if (mins) {
    const cut = ymdOf(new Date(now.getTime() - (MAP_WKS * 7 - 1) * 86400000));
    for (const [k, v] of mins) if (k >= cut) sumAll += v;
  }
  const fmtH = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 750, color: K.txt, letterSpacing: "-0.02em" }}>Focus activity</div>
          <div style={{ fontSize: 12, color: K.sub, marginTop: 3 }}>
            Every day you focused over the last {MAP_WKS} weeks — darker means more focused minutes that day
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: K.sub, textAlign: "right" }}>
          {mins ? (
            <>
              <span style={{ fontSize: 22, fontWeight: 750, color: K.txt, fontVariantNumeric: "tabular-nums" }}>{fmtH(sumAll)}</span>
              <span> focused · last {MAP_WKS} weeks</span>
            </>
          ) : ""}
        </div>
      </div>

      <div style={{ ...card(), padding: "18px 18px 14px", width: "100%", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {/* Month labels */}
        <div style={{ display: "flex", gap: 6, paddingLeft: 26, marginBottom: 6 }}>
          {cols.map((_, w) => (
            <div key={w} style={{ width: 22, flexShrink: 0, fontSize: 10.5, color: K.muted, lineHeight: 1, whiteSpace: "nowrap", textAlign: "left", fontWeight: 650 }}>
              {monthAt(w) ? MNS[cols[w][0].d.getMonth()] : ""}
            </div>
          ))}
        </div>
        {/* Week rows (22px cells — a major statistic you can read across the room) */}
        {cols[0].map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
            <div style={{ width: 20, fontSize: 10, color: K.muted, textAlign: "left", lineHeight: 1, fontWeight: 650 }}>{HM_DOW[r]}</div>
            {cols.map((_, w) => {
              const { ymd } = cols[w][r];
              const m   = mins?.get(ymd) || 0;
              const lvl = HM_LVL(m);
              const fut = ymd > td;
              return (
                <button key={ymd} type="button" tabIndex={-1} className="b"
                  aria-hidden={fut ? "true" : undefined}
                  aria-label={fut ? undefined : m ? `${ymd} · ${m} min focused` : `${ymd} · no focus`}
                  title={fut ? undefined : m ? `${ymd} — ${m} min focused` : `${ymd} — no focus`}
                  style={{
                    width: 22, height: 22, borderRadius: 5, padding: 0, flexShrink: 0,
                    background: fut ? "transparent" : lvl === 0 ? K.border : K.acc + MAP_AL[lvl - 1],
                    boxShadow: ymd === td && !fut ? `inset 0 0 0 2px ${K.acc}` : "none",
                    cursor: fut ? "default" : "pointer",
                  }} />
              );
            })}
          </div>
        ))}
        {/* Legend — states what each colour MEANS (minutes per day), so the
            map can be read without guessing at the scale. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingRight: 1, flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: K.muted }}>Less</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {HM_LBL.map((lbl, l) => (
              <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{
                  width: 14, height: 14, borderRadius: 3.5,
                  background: l === 0 ? K.border : K.acc + MAP_AL[l - 1],
                }} />
                <span style={{ fontSize: 10.5, color: K.muted }}>{lbl}</span>
              </span>
            ))}
          </div>
          <span style={{ fontSize: 10.5, color: K.muted }}>More focused</span>
        </div>
      </div>
      {mins && sumAll === 0 && (
        <div style={{ ...card(), marginTop: 8, textAlign: "center", color: K.muted, fontSize: 11, padding: "12px 10px" }}>
          Complete focus sessions to light up your activity map
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FOCUS / POMODORO
// ══════════════════════════════════════════════════════════════════════════
const F_NAMES = ["Focus", "Short Break", "Long Break"];
const F_STEP  = { w: 5, sb: 1, lb: 5 };   // stepper increments (minutes)
const F_MIN   = { w: 5, sb: 1, lb: 10 };  // clamp bounds
const F_MAX   = { w: 120, sb: 30, lb: 90 };
const F_COLS  = () => [K.acc, K.ok, K.warn];
const hm  = (ms) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;
const dur = (secs) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`);

// Device-local handoff for "focus on this task": the Tasks screen sets the id
// and navigates here; Focus consumes it once on mount. Not synced, not
// persisted — it only seeds the picker so the next session starts attached.
let focusTaskSeed = null;

// A small split-flap display for Screensaver. It owns only wall-clock time;
// the Pomodoro countdown remains in Focus and is never duplicated here.
function FlipDigit({ value }) {
  const [shown, setShown] = useState(value);
  const [previous, setPrevious] = useState(value);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (value === shown) return undefined;
    setPrevious(shown);
    setShown(value);
    setFlipping(true);
    const id = setTimeout(() => setFlipping(false), 460);
    return () => clearTimeout(id);
  }, [value, shown]);
  return <span className={`north-flip-digit${flipping ? " is-flipping" : ""}`} aria-hidden="true">
    <span className="north-flip-top">{shown}</span>
    <span className="north-flip-bottom">{shown}</span>
    {flipping && <>
      <span className="north-flip-flap north-flip-flap-top">{previous}</span>
      <span className="north-flip-flap north-flip-flap-bottom">{shown}</span>
    </>}
  </span>;
}

function FlipClock({ accent = "#8B8FF7", surface = "#15171c" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const digits = (value, label) => [...value].map((digit, index) => <FlipDigit key={`${label}-${index}`} value={digit} />);
  return <div className="north-flip-clock" style={{ "--flip-accent": accent, "--flip-surface": surface }} aria-label={`Local time ${hh}:${mm}:${ss}`}>
    <div className="north-flip-group">{digits(hh, "hours")}</div>
    <span className="north-flip-colon" aria-hidden="true">:</span>
    <div className="north-flip-group">{digits(mm, "minutes")}</div>
    <span className="north-flip-colon north-flip-seconds-colon" aria-hidden="true">:</span>
    <div className="north-flip-group north-flip-seconds">{digits(ss, "seconds")}</div>
  </div>;
}

// ══════════════════════════════════════════════════════════════════════════
// IMMERSIVE FOCUS MODE
// ══════════════════════════════════════════════════════════════════════════
/**
 * The distraction-free overlay over the Focus screen: the glass dial scaled
 * up, the linked task, the phase, the coming-up strip and — when connected —
 * the Spotify controls. Same timer state as the normal view (this renders it,
 * it does not own it), so entering/leaving never touches timing. The flip
 * clock is part of Focus; there is no separate screensaver mode.
 */
function ImmersiveFocus({ children, onExit, task, spotify, upcoming, envId, envPhoto }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    if (appRoot) appRoot.inert = true;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialog.current?.querySelector("button")?.focus();
    return () => {
      if (appRoot) appRoot.inert = wasInert;
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onExit();
      if (e.key === "Tab") {
        const controls = [...dialog.current.querySelectorAll("button, summary, [tabindex='0']")].filter((el) => !el.disabled && el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);
  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Focus mode"
      className="genv north-immersive"
      style={{
        // Environment FIRST, then the overlay's own box. GLASS_ENV returns
        // `position: relative` + `minHeight: 100vh`; spreading it after
        // `position: fixed` silently turned this overlay into an in-flow
        // block, so it scrolled with the page instead of covering it and its
        // lower half was unreachable in a short window.
        ...GLASS_ENV(envId, envPhoto),
        position: "fixed", inset: 0, zIndex: 2147483000,
        // border-box so the 100vh floor from GLASS_ENV is the whole box: with
        // content-box sizing the 24px padding was added on top of it and the
        // overlay hung 48px below a short viewport.
        boxSizing: "border-box",
        display: "flex", flexDirection: "column", alignItems: "center",
        // `safe` keeps the first child reachable when the content is taller
        // than the viewport (a phone in landscape); plain `center` pushes it
        // above the top edge where no scroll can reach it.
        justifyContent: "flex-start", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
        padding: 16, animation: "pge .24s cubic-bezier(.2,.8,.3,1) both",
      }}>
      {ENV_WALL_LAYER(isKnownEnv(envId) ? envId : DEFAULT_ENV_ID)}
      {ENV_PHOTO_LAYER(envId, envPhoto)}
      <div className="north-immersive-toolbar">
      <button type="button" className="b north-immersive-exit" onClick={onExit}
        aria-label="Close focus mode" title="Close focus mode">
        <X size={20} aria-hidden="true" />
      </button>
      <button type="button" className="b north-fullscreen-toggle" aria-label="Toggle fullscreen" title="Toggle fullscreen" onClick={() => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else dialog.current?.requestFullscreen?.().catch(() => {});
      }}><Maximize2 size={16} aria-hidden="true" /></button>
      </div>
      {task && (
        <div style={{
          fontSize: 12.5, color: K.sub, marginBottom: 10, maxWidth: 480, textAlign: "center",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          padding: "5px 14px", borderRadius: 999, background: GK.tintSubtle,
          border: `1px solid ${GK.edge}`, boxShadow: `inset 0 1px 0 ${GK.hi}`,
        }}>
          <span style={{ color: K.acc, fontWeight: 700, fontSize: 10, letterSpacing: 0.6 }}>TASK</span>
          <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>{task}
        </div>
      )}
      {children /* the dial + phase + controls */}
      {spotify}
      {/* Optional context, not clutter: the next Google event on today's
          schedule (read from the same cache the Calendar screen uses), so a
          session can be planned around what follows it. Renders nothing when
          Calendar isn't connected or nothing is left today. */}
      {upcoming && (
        <div style={{
          marginTop: 16, fontSize: 12, color: K.muted, maxWidth: 460, textAlign: "center",
          display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
          padding: "7px 14px", borderRadius: 999, background: GK.tintSubtle,
          border: `1px solid ${GK.edge}`,
        }}>
          <Calendar aria-hidden="true" size={13} color={K.warn} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Next: {upcoming.title}
          </span>
          <span style={{ color: K.sub, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {upcoming.label}
          </span>
        </div>
      )}
    </div>, document.body
  );
}

function Focus({ user, envId, envPhoto, go }) {
  // Local copy of the timer profile so duration edits apply instantly and
  // persist to the user record; sound/notify flags ride along in the same
  // object so they stay per-device until real account settings exist.
  const [pm, setPm] = useState({ w: 25, sb: 5, lb: 15, sound: false, notify: false, ...(user.pm || {}) });
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const DURS = [pm.w * 60, pm.sb * 60, pm.lb * 60];

  // The task the next session will be attached to, if any. Purely optional:
  // with nothing selected the timer behaves exactly as it always has. Only
  // open (not completed) tasks are offered; the choice survives a pause but
  // resets when a session completes, like the phase does.
  const [tasks, setTasks] = useState(() => Array.isArray(user.tasks) ? user.tasks : []);
  useEffect(() => { setTasks(Array.isArray(user.tasks) ? user.tasks : []); }, [user.tasks]);
  const openTasks = tasks.filter((t) => !t.completed);
  const [taskSel, setTaskSel] = useState(() => {
    const seed = focusTaskSeed;
    focusTaskSeed = null;
    return openTasks.some((t) => t.id === seed) ? seed : null;
  });
  const taskR = useRef(taskSel); taskR.current = taskSel;
  useEffect(() => {
    if (taskSel && !tasks.some((task) => task.id === taskSel && !task.completed)) {
      setTaskSel(null);
      taskR.current = null;
    }
  }, [taskSel, tasks]);

  const completeLinkedTask = async () => {
    if (!taskR.current) return;
    const updated = tasks.map((task) => task.id === taskR.current ? { ...task, completed: true } : task);
    setTasks(updated);
    const profile = (await S.get(PROFILE_KEY(user.un))) || {};
    await S.set(PROFILE_KEY(user.un), { ...profile, tasks: updated });
    const leaderboard = (await S.get(`lb:${user.un}`, true)) || {};
    await S.set(`lb:${user.un}`, { ...leaderboard, tc: updated.filter((task) => task.completed).length }, true);
    setTaskSel(null);
    taskR.current = null;
  };

  const [phase, setPhase] = useState(0);
  const [t, setT]         = useState(DURS[0]);
  const [on, setOn]       = useState(false);
  const [sess, setSess]   = useState(0);
  const [todayMin, setTodayMin] = useState(0);
  const [hist, setHist]   = useState([]); // today's persisted session records

  const phR    = useRef(0);     phR.current    = phase;
  const sR     = useRef(0);     sR.current     = sess;
  const tR     = useRef(DURS[0]); tR.current   = t;
  const ivR    = useRef(null);
  const endR   = useRef(0);     // wall-clock deadline (ms) while running
  const startR = useRef(0);     // when the current session began running
  const run    = useRef(null);  // latest `finish`, called by the ticking interval
  const audioR = useRef(null);  // shared WebAudio context for the chime
  const titleR = useRef(typeof document !== "undefined" ? document.title : "");

  // Publish the running session into the shared blocking state that the
  // extension and desktop clients read, so "block during focus" is one fact
  // rather than four. Fire-and-forget: a storage failure must never stall the
  // timer itself.
  const publishFocus = async (focus) => {
    try {
      const u = (await S.get(PROFILE_KEY(user.un))) || {};
      const b = normalizeState(u.blocking || defaultBlocking());
      await S.set(PROFILE_KEY(user.un), { ...u, blocking: { ...b, focus } });
      // Focus Mode is enforced by the browser, not by this tab: tell the
      // extension the window changed so blocking starts and stops with the
      // timer instead of waiting for the next background refresh.
      notifyExtension("north-focus");
    } catch { /* device storage unavailable — the timer still runs */ }
  };

  // Restore today's totals from persisted raw records, not from volatile UI
  // state: minutes come from the daily `fo` total (back-compat), session and
  // cycle counts are derived from the durable per-session records.
  useEffect(() => {
    const fsKey = `fs:${user.un}:${today()}`;
    Promise.all([S.get(`fo:${user.un}:${today()}`), S.get(fsKey)]).then(([d, recs]) => {
      if (d?.s) setTodayMin(Math.floor(d.s / 60));
      const list = recs || [];
      setHist(list);
      setSess(list.length); sR.current = list.length;
    });
  }, [user.un]);

  const addFocus = async (secs) => {
    const key = `fo:${user.un}:${today()}`;
    const ex  = (await S.get(key)) || { s: 0 };
    const ns  = ex.s + secs;
    await S.set(key, { s: ns });
    setTodayMin(Math.floor(ns / 60));
    const lb  = (await S.get(`lb:${user.un}`, true)) || {};
    const str = lb.last === yesterday() ? (lb.streak || 0) + 1 : lb.last !== today() ? 1 : lb.streak || 0;
    await S.set(`lb:${user.un}`, { ...lb, fm: (lb.fm || 0) + Math.floor(secs / 60), last: today(), streak: str }, true);
  };

  const primeAudio = () => {
    // Create the audio context inside a user gesture (Start click) so the
    // end-of-session chime isn't blocked by autoplay policies.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioR.current) audioR.current = new AC();
    } catch {}
  };
  const chime = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioR.current) audioR.current = new AC();
      const a = audioR.current;
      if (a.state === "suspended") a.resume().catch(() => {});
      const tone = (f, delay) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = "sine"; o.frequency.value = f;
        const t = a.currentTime + delay;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g); g.connect(a.destination);
        o.start(t); o.stop(t + 1);
      };
      tone(880, 0);
      tone(1174.66, 0.22); // soft two-note chime
    } catch { /* audio unavailable — no-op */ }
  };
  const endNotify = (p) => {
    if (pm.sound) chime();
    if (!pm.notify || typeof Notification === "undefined") return;
    try {
      if (Notification.permission === "granted")
        new Notification("NORTH", { body: p === 0 ? "Focus session complete — time for a break." : "Break's over — ready to focus?" });
    } catch {}
  };
  // Duration editing lives on the Settings page (the single customization
  // surface). This component only READS the pomodoro profile (`user.pm`) —
  // Sound/notify flags are still honoured at session end by endNotify().
  // The reminder permission is requested in Settings.

  const finish = async (skip = false) => {
    clearInterval(ivR.current);
    publishFocus(null); // the blocking window closes with the session
    const p = phR.current;
    if (!skip) endNotify(p); // natural completion → chime / notification
    if (p === 0) {
      // Bank only the time actually focused: a skipped session gets partial
      // credit, a naturally finished one banks the full duration (t=0).
      const elapsed = Math.max(0, DURS[0] - tR.current);
      if (elapsed > 0) {
        await addFocus(elapsed);
        // Persist a durable session record. These raw time-series records are
        // the source for counts, history, future analytics/heatmaps and sync —
        // never derive those from volatile in-memory counters.
        const key = `fs:${user.un}:${today()}`;
        const recs = (await S.get(key)) || [];
        recs.push({
          id: uid(),
          type: "focus",
          start: startR.current || Date.now() - elapsed * 1000,
          end: Date.now(),
          planned: DURS[0],
          actual: elapsed,
          completed: elapsed >= DURS[0] - 1,
          // Optional link to the task this session worked on. Recorded even if
          // the task was deleted mid-session — the session is a historical
          // record; the sync layer nulls a dead reference at the foreign key.
          ...(taskR.current ? { taskId: taskR.current } : {}),
        });
        await S.set(key, recs);
        setHist(recs);
        setSess(recs.length); sR.current = recs.length;
      }
      const n    = sR.current;
      const next = n > 0 && n % 4 === 0 ? 2 : 1;
      setPhase(next); phR.current = next;
      setT(DURS[next]); tR.current = DURS[next];
      // One session per task choice: the picker clears with the phase, so the
      // next run is deliberate rather than silently re-charged.
      setTaskSel(null); taskR.current = null;
    } else {
      setPhase(0); phR.current = 0;
      setT(DURS[0]); tR.current = DURS[0];
    }
    startR.current = 0;
    setOn(false);
  };
  run.current = finish;

  useEffect(() => {
    if (on) {
      // Count down against a wall-clock deadline instead of decrementing once
      // per second: browsers throttle setInterval in background tabs, which
      // makes a naive tick timer drift or stall. Recomputing from Date.now()
      // every 250 ms stays accurate no matter how rarely the tab runs.
      endR.current = Date.now() + tR.current * 1000;
      if (!startR.current) startR.current = Date.now();
      ivR.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((endR.current - Date.now()) / 1000));
        // Mirror the countdown into the tab title so it stays visible even
        // after the user switches away; the deadline math above keeps the
        // count itself accurate.
        try { document.title = `${pad2(Math.floor(left / 60))}:${pad2(left % 60)} · ${F_NAMES[phR.current]}`; } catch {}
        if (left <= 0) {
          clearInterval(ivR.current);
          setT(0); tR.current = 0;
          if (run.current) run.current();
        } else if (left !== tR.current) {
          setT(left); tR.current = left;
        }
      }, 250);
    }
    // Restore the host page's title whenever the timer stops or unmounts.
    return () => { clearInterval(ivR.current); try { document.title = titleR.current; } catch {} };
  }, [on]);

  const goPhase = (i) => { setOn(false); startR.current = 0; publishFocus(null); setPhase(i); phR.current = i; setT(DURS[i]); tR.current = DURS[i]; };
  const reset   = () => { setOn(false); startR.current = 0; publishFocus(null); setT(DURS[phase]); tR.current = DURS[phase]; };
  // Start/pause publishes or clears the shared focus window (a resume gets a
  // fresh end time, which is what the blocking engine needs).
  const toggleRun = () => {
    primeAudio();
    const next = !on;
    publishFocus(next ? startFocusSession(Math.max(1, Math.ceil(tR.current / 60)), Date.now()) : null);
    setOn(next);
  };

  const mm = pad2(Math.floor(t / 60));
  const ss = pad2(t % 60);
  const R = 90, circ = 2 * Math.PI * R;
  const prog = 1 - t / DURS[phase];
  const col  = F_COLS()[phase];
  const [immersive, setImmersive] = useState(false);
  /**
   * Focus Mode = the old Immersive plus the existing blocking engine. It adds
   * NO new rule and NO second system: it simply runs the same focus window the
   * Pomodoro start button publishes (publishFocus → blocking.focus), which
   * every client already evaluates — rules with when:"focus" and the
   * blockDuringFocus setting are already enforced by the extension and the
   * desktop app for exactly this window. Starting the timer and entering Focus
   * Mode share one code path, so their windows can never disagree.
   */
  const enterFocusMode = () => {
    if (!on) toggleRun();          // Focus Mode and the timer are one session
    setImmersive(true);            // the distraction-free overlay
  };
  const exitFocusMode = () => setImmersive(false); // timer + Flow keep running
  const taskTitle = tasks.find((x) => x.id === taskSel)?.title ?? null;
  // Spotify rides along inside immersive mode only — a quiet strip under the
  // dial. Renders nothing when not connected (spotifyControl failure paths
  // are honest text, never faked playback).
  const spotifyMini = <div className="north-spotify-float" style={{ "--spotify-surface": GK.tintStrong, "--spotify-edge": GK.edge, "--spotify-ink": K.txt, "--spotify-highlight": GK.hi }}><SpotifyFloatingPlayer /></div>;

  const phaseTabs = <div className="focus-phase-tabs" role="group" aria-label="Pomodoro phase" style={{ display: "flex", gap: 6, margin: "0 auto 18px", width: "min(100%, 620px)" }}>
    {F_NAMES.map((name, index) => (
      <button key={name} type="button" className="b" onClick={() => goPhase(index)} aria-pressed={phase === index}
        style={{ ...tag(phase === index, F_COLS()[index]), flex: 1, textAlign: "center", padding: "10px 4px" }}>{name}</button>
    ))}
  </div>;

  // The dial + controls, shared by normal and immersive views.
  const dial = (
    <>
      <FlipClock accent={K.acc} surface={GK.tintCard} />
      {phaseTabs}
      <div className="focus-dial-row" style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <div className="gcard focus-dial" style={{
          position: "relative", width: 300, height: 300, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 10px 40px rgba(0,0,0,${K.bg === "#0C0D12" ? ".35" : ".10"}), inset 0 1px 0 ${GK.hi}`,
          transform: immersive ? "scale(1.18)" : "none", transition: "transform .3s cubic-bezier(.2,.8,.3,1)",
        }}>
          {/* width/height 100% (not the fixed desktop box) so the ring is always
              concentric with its card, whatever size the card resolves to. */}
          <svg viewBox="0 0 220 220" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
            <circle cx="110" cy="110" r={R} fill="none" stroke={GK.edge} strokeWidth="7" />
            <circle cx="110" cy="110" r={R} fill="none" stroke={col}
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - prog)}
              style={{ transition: "stroke-dashoffset .9s ease", filter: `drop-shadow(0 0 6px ${col}55)` }} />
          </svg>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 54, fontWeight: 200, color: K.txt, letterSpacing: -2, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {mm}:{ss}
            </div>
            <div style={{ fontSize: 11, color: K.sub, marginTop: 6, letterSpacing: 1.4 }}>
              {F_NAMES[phase].toUpperCase()}
            </div>
          </div>
        </div>
      </div>
      <div className="north-timer-controls" style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 28 }}>
        {[
          { I: RotateCcw, w: 48, a11y: "Reset timer", onClick: reset },
          { I: on ? Pause : Play, w: 80, a11y: on ? "Pause" : "Start", primary: true, onClick: toggleRun },
          { I: SkipForward, w: 48, a11y: "Skip session", onClick: () => finish(true) },
          { I: Maximize2, w: 48, a11y: immersive ? "Exit focus mode" : "Enter focus mode", onClick: immersive ? exitFocusMode : enterFocusMode },
        ].map((b) => (
          <button key={b.a11y} type="button" className={b.primary ? "b gacc" : "b gcard ghov"} onClick={b.onClick} aria-label={b.a11y}
            title={b.a11y}
            style={{
              width: b.w, height: 48, borderRadius: b.primary ? 16 : 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: b.primary ? col : undefined,
              border: b.primary ? "none" : undefined,
              color: b.primary ? "#fff" : K.sub,
            }}>
            <b.I size={b.primary ? 22 : 17} strokeWidth={2.2} color={b.primary ? "#fff" : K.sub} />
          </button>
        ))}
      </div>
    </>
  );

  if (immersive) {
    // The next event left on today's schedule (Calendar-connected users only)
    // — quiet context so a session can be planned around what follows it.
    return (
      <>
        {G()}
        <ImmersiveFocus onExit={exitFocusMode} task={taskTitle} envId={envId} envPhoto={envPhoto} spotify={spotifyMini}>
          {dial}
        </ImmersiveFocus>
      </>
    );
  }

  return (
    <div className="focus-world genv" style={{ ...GLASS_ENV(envId, envPhoto), "--focus-accent": col, "--focus-ok": K.ok, "--focus-warn": K.warn }}>
      <div className="focus-inner">
      <div className="focus-heading">
        <div className="focus-heading-start">
          <button type="button" className="b focus-settings-icon focus-enter-icon" onClick={enterFocusMode} aria-label="Enter focus mode" title="Enter focus mode"><Maximize2 size={17} /></button>
          <h2 style={{ color: K.txt, fontSize: 24, fontWeight: 600, letterSpacing: "-0.025em", margin: 0 }}>Focus</h2>
        </div>
        <div className="focus-ambient-actions">
          <button type="button" className="b focus-mini-action focus-settings-icon" onClick={() => setPreferencesOpen((v) => !v)} aria-label={preferencesOpen ? "Close focus settings" : "Focus settings"} title={preferencesOpen ? "Close focus settings" : "Focus settings"} aria-expanded={preferencesOpen} aria-controls="focus-preferences"><Settings size={17} /></button>
        </div>
      </div>

      {preferencesOpen && <section id="focus-preferences" aria-label="Focus settings">
        <FocusPreferences user={{ ...user, pm }} onUpdate={(next) => {
          setPm(next);
          if (!on && !startR.current) setT([next.w, next.sb, next.lb][phase] * 60);
        }} />
        <p style={{ color: K.sub, fontSize: 12 }}>Changes apply to the next session. An active session keeps its duration.</p>
      </section>}
      {/* Working-on picker (optional). Hidden entirely when there are no open
          tasks — the timer reads exactly as it did before this existed. A
          native select (keyboard/screen-reader/phone-picklist for free)
          styled to North's surfaces; every open task appears by name, with
          its due state so same-titled tasks stay distinguishable. */}
      <div style={{ width: "min(100%, 620px)", margin: "0 auto 14px" }}>
          <div style={{ color: K.sub, fontSize: 11, fontWeight: 650, marginBottom: 6 }}>Working on</div>
          {openTasks.length ? <FocusTaskPicker tasks={openTasks} value={taskSel || ""} dueLabel={dueLabel}
            onChange={(value) => { setTaskSel(value); taskR.current = value; }} /> :
            <button type="button" className="b gcard ghov" onClick={() => go?.("tasks")}
              style={{ width: "100%", padding: "13px 16px", borderRadius: 14, color: K.sub, textAlign: "left" }}>
              No open tasks · add one in Tasks
            </button>}
          {taskSel && (
            <button type="button" className="b" onClick={() => { setTaskSel(null); taskR.current = null; }}
              aria-label="Clear selected task"
              style={{ color: K.muted, display: "flex", padding: 4, flexShrink: 0 }}><X size={14} color={K.muted} /></button>
          )}
      </div>
      {/* Which task the session is attached to, stated in words — the link is
          recorded on the session record, so it must be readable, not implied
          by which option a closed dropdown happens to show. */}
      {taskSel && taskTitle && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 520,
            fontSize: 12, color: K.sub, padding: "5px 14px", borderRadius: 999,
            background: GK.tintSubtle, border: `1px solid ${GK.edge}`, boxShadow: `inset 0 1px 0 ${GK.hi}`,
          }}>
            <span style={{ color: K.acc, fontWeight: 700, fontSize: 9.5, letterSpacing: 0.6 }}>WORKING ON</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: K.txt, fontWeight: 550 }}>{taskTitle}</span>
            <button type="button" className="b" onClick={completeLinkedTask}
              aria-label={`Complete task ${taskTitle}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: K.ok, fontSize: 11, fontWeight: 650, padding: "3px 6px" }}>
              <Check size={12} color={K.ok} aria-hidden="true" /> Complete
            </button>
          </span>
        </div>
      )}

      {/* Coming up — today's next Google event(s), quiet context beside the
          timer. Read-only, deduped by the shared cache; never touches timing. */}
      {/* Phase tabs */}
      {/* Ring — North Glass focus centerpiece: a glass dial carrying the
          countdown. Timer logic untouched; presentation only. */}
      <div className="focus-hero" style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <div className="focus-hero-glow" aria-hidden="true" />
        <div className="gcard" style={{
          position: "relative", width: 300, height: 300, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 22px 70px rgba(0,0,0,${K.dark ? ".38" : ".12"}), inset 0 1px 0 ${GK.hi}`,
        }}>
          {/* The ring tracks the dial's responsive glass card. */}
          <svg viewBox="0 0 220 220" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
            <circle cx="110" cy="110" r={R} fill="none" stroke={GK.edge} strokeWidth="5" />
            <circle cx="110" cy="110" r={R} fill="none" stroke={col}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - prog)}
              style={{ transition: "stroke-dashoffset .9s ease", filter: `drop-shadow(0 0 6px ${col}55)` }} />
          </svg>
          <div style={{
            position: "relative",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ fontSize: "clamp(62px, 8vw, 78px)", fontWeight: 200, color: K.txt, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {mm}:{ss}
            </div>
            <div style={{ fontSize: 11, color: K.sub, marginTop: 8, letterSpacing: 1.6, fontWeight: 650 }}>
              {F_NAMES[phase].toUpperCase()}
            </div>
            <div style={{ fontSize: 9, color: K.muted, marginTop: 9, letterSpacing: 1.1 }}>{on ? "IN SESSION" : "READY WHEN YOU ARE"}</div>
          </div>
        </div>
      </div>

      {/* Session dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 28 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: i < sess % 4 ? col : K.border, transition: "background .3s",
          }} />
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 28 }}>
        {[
          { I: RotateCcw, w: 48, a11y: "Reset timer", onClick: reset },
          { I: on ? Pause : Play, w: 80, a11y: on ? "Pause" : "Start", primary: true, onClick: toggleRun },
          { I: SkipForward, w: 48, a11y: "Skip session", onClick: () => finish(true) },
          { I: Maximize2, w: 48, a11y: immersive ? "Exit focus mode" : "Enter focus mode", onClick: immersive ? exitFocusMode : enterFocusMode },
        ].map((b) => (
          <button key={b.a11y} type="button" className={b.primary ? "b gacc" : "b gcard ghov"} onClick={b.onClick} aria-label={b.a11y}
            title={b.a11y}
            style={{
              width: b.w, height: 48, borderRadius: b.primary ? 16 : 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: b.primary ? col : undefined,
              border: b.primary ? "none" : undefined,
              color: b.primary ? "#fff" : K.sub,
            }}>
            <b.I size={b.primary ? 22 : 17} strokeWidth={2.2} color={b.primary ? "#fff" : K.sub} />
          </button>
        ))}
      </div>
      {!preferencesOpen && spotifyMini}

      {/* Timer durations moved to the Settings page (the single place for
          customization). The Focus screen holds only the navigation action. */}

      {/* Session totals as one line, not three cards: the timer is the hero
          here, and three panels under it competed with it (and hid more of the
          wallpaper). Same numbers, stated plainly. */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: 10, fontSize: 13.5, color: K.sub }}>
        {[
          { lbl: "today", val: `${todayMin}m`, col: K.acc },
          { lbl: sess === 1 ? "session" : "sessions", val: sess, col: K.warn },
          { lbl: Math.floor(sess / 4) === 1 ? "cycle" : "cycles", val: Math.floor(sess / 4), col: K.ok },
        ].map((s, i) => (
          <span key={s.lbl} style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
            {i > 0 && <span aria-hidden="true" style={{ color: K.muted }}>·</span>}
            <span><b style={{ color: s.col, fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.val}</b> {s.lbl}</span>
          </span>
        ))}
      </div>

      {/* Today's history (from persisted session records) */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: K.txt, marginBottom: 10 }}>Today's sessions</div>
        {hist.length === 0 ? (
          <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 12, padding: "18px 12px" }}>
            No focus sessions yet — start one above
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...hist].slice(-6).reverse().map((r) => (
              <div key={r.id} style={{ ...card2(), display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: r.completed ? K.ok : K.warn,
                }} />
                <div style={{ flex: 1, fontSize: 12, color: K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.completed ? "Completed focus" : "Skipped focus"}
                  {(() => {
                    const t = tasks.find((x) => x.id === r.taskId);
                    return t ? <span style={{ color: K.sub }}> · {t.title}</span> : null;
                  })()}
                </div>
                <div style={{ fontSize: 11, color: K.muted }}>{hm(r.start)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: r.completed ? K.ok : K.sub, fontVariantNumeric: "tabular-nums" }}>
                  {dur(r.actual)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════════════════════════
const T_CATS = ["Personal", "Work", "Study", "Health"];
// The three task scales, each with the words the form and the row show. They
// are spelled out everywhere (never a bare "Medium") because the same word
// means something different in each scale — the form labels its groups and
// every row prints "Priority"/"Difficulty"/category, not just its colour.
const T_PRI  = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
const T_DIFF = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]];
/** Older records have no difficulty; read them as medium rather than undefined. */
const diffOf   = (t) => (T_DIFF.some(([v]) => v === t?.diff) ? t.diff : "medium");
const priLabel = (p) => (T_PRI.find(([v]) => v === p) || T_PRI[1])[1];
const diffLabel= (d) => (T_DIFF.find(([v]) => v === d) || T_DIFF[1])[1];

/**
 * Human-readable due label — "Today", "Tomorrow", "Overdue · Sep 20",
 * "Sep 28" — or "" when there is no date. Shared by the Tasks list and the
 * Board cards so one record never shows a raw ISO string in one place and a
 * readable date in the other.
 */
const dueLabel = (due, completed) => {
  if (!due) return "";
  const td = today();
  const p  = due.split("-");
  if (due < td && !completed) return `Overdue · ${MNS[Number(p[1]) - 1]} ${Number(p[2])}`;
  if (due === td) return "Today";
  // Tomorrow in LOCAL time, not UTC: toISOString() near midnight could label
  // the wrong day (the exact date-shift bug this label must never have).
  const tm = new Date(Date.now() + 86400000);
  if (due === `${tm.getFullYear()}-${pad2(tm.getMonth() + 1)}-${pad2(tm.getDate())}`) return "Tomorrow";
  return `${MNS[Number(p[1]) - 1]} ${Number(p[2])}`;
};

/** Label above an input/textarea in the task form. */
const fldLbl = { fontSize: 11, color: K.sub, fontWeight: 600, display: "block", marginBottom: 6 };

/**
 * A named row of exclusive choices. Deliberately a set of `aria-pressed`
 * buttons rather than a half-implemented radiogroup: each is reachable by Tab
 * and toggled with Space/Enter, the chosen one is announced, and the words
 * carry the meaning — the accent tint is decoration, never the message.
 */
const SegGroup = ({ id, label, options, value, onPick }) => (
  <div style={{ marginBottom: 12 }}>
    <span id={id} style={{ ...fldLbl, marginBottom: 6 }}>{label}</span>
    <div role="group" aria-labelledby={id} style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {options.map(([v, lbl]) => (
        <button key={v} type="button" className="b" aria-pressed={value === v}
          onClick={() => onPick(v)}
          style={{ ...tag(value === v, K.acc), padding: "7px 15px", fontSize: 12 }}>{lbl}</button>
      ))}
    </div>
  </div>
);

// One blank draft. A single factory keeps the Add form and the Edit form
// showing exactly the same fields — an edit is the same form, prefilled, and
// there is no second code path to drift out of sync with it.
const blankTask = () => ({ title: "", due: today(), pri: "medium", diff: "medium", cat: "Personal", desc: "" });
function Tasks({ user, go }) {
  const [tasks,   setTasks]   = useState(user.tasks || []);
  const [filter,  setFilter]  = useState("today");
  const [showAdd, setShowAdd] = useState(false);
  const [nt,      setNt]      = useState(blankTask);
  const [dueText, setDueText] = useState(() => taskDateText(today()));
  const [dueError, setDueError] = useState("");
  // Non-null while the form is editing an existing task instead of adding one.
  const [editId,  setEditId]  = useState(null);

  const persist = async (updated) => {
    setTasks(updated);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, tasks: updated });
    const lb = (await S.get(`lb:${user.un}`, true)) || {};
    await S.set(`lb:${user.un}`, { ...lb, tc: updated.filter((t) => t.completed).length }, true);
  };

  /** Add, or save the task currently being edited. Same validation, same
   *  persistence — the only difference is whether a new id is minted. */
  const submit = async () => {
    const title = nt.title.trim();
    if (!title) return;
    const due = parseTaskDate(dueText);
    if (due === null) { setDueError("Enter a real date as DD/MM/YYYY."); return; }
    const fields = { title, due, pri: nt.pri, diff: nt.diff, cat: nt.cat, desc: nt.desc.trim() };
    if (editId) await persist(tasks.map((t) => (t.id === editId ? { ...t, ...fields } : t)));
    else        await persist([...tasks, { id: uid(), ...fields, completed: false, at: Date.now() }]);
    closeForm();
  };
  const closeForm = () => { setShowAdd(false); setEditId(null); setNt(blankTask()); setDueText(taskDateText(today())); setDueError(""); };
  const openEdit = (task) => {
    setEditId(task.id);
    setShowAdd(true);
    setNt({
      title: task.title || "",
      due: task.due || "",
      pri: T_PRI.some(([v]) => v === task.pri) ? task.pri : "medium",
      diff: diffOf(task),
      cat: T_CATS.includes(task.cat) ? task.cat : "Personal",
      desc: task.desc || "",
    });
    setDueText(taskDateText(task.due || ""));
    setDueError("");
  };
  const toggle = (id) => persist(tasks.map((t) => t.id === id ? { ...t, completed: !t.completed } : t));
  const del    = (id) => { if (editId === id) closeForm(); persist(tasks.filter((t) => t.id !== id)); };

  // Upcoming is distinguished by being strictly in the future; Today carries
  // what is due today AND what is already overdue, because an overdue task is
  // work for today — hiding it behind the "All" filter would bury the one
  // thing that most needs doing.
  const filt = tasks.filter((t) => {
    if (filter === "today")    return !t.completed && t.due && t.due <= today();
    if (filter === "upcoming") return !t.completed && t.due > today();
    if (filter === "done")     return t.completed;
    return true;
  });

  return (
    <div className="npage">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ ...pageTitle() }}>Tasks</h2>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            <span style={{ color: K.ok }}>{tasks.filter((t) => t.completed).length}</span>
            {" "}of {tasks.length} complete
          </div>
        </div>
        <button type="button" className="b" onClick={() => (showAdd ? closeForm() : setShowAdd(true))}
          aria-label={showAdd ? "Close task form" : "Add task"}
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: showAdd ? K.card : K.acc,
            border: showAdd ? `1px solid ${K.border}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: K.onAcc,
          }}>{showAdd ? <X size={18} color={K.sub} /> : <Plus size={18} color={K.onAcc} />}</button>
      </div>

      {/* The task form — Add and Edit are the same form. Every control is
          labeled, and the three scales that all use the word "Medium" are
          grouped and named, so nothing here depends on remembering which
          dropdown is which (or on seeing a colour). */}
      {showAdd && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ ...card(), marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, color: K.txt, marginBottom: 12 }}>
            {editId ? "Edit task" : "New task"}
          </div>

          <label htmlFor="task-title" style={fldLbl}>Task title</label>
          <input id="task-title" autoFocus style={{ ...inpSt(), marginBottom: 12 }}
            placeholder="What needs doing?"
            value={nt.title} onChange={(e) => setNt((n) => ({ ...n, title: e.target.value }))} />

          <label htmlFor="task-due" style={fldLbl}>Due date <span style={{ color: K.muted, fontWeight: 400 }}>· DD/MM/YYYY</span></label>
          <input id="task-due" type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/YYYY" maxLength={10}
            style={{ ...inpSt(), marginBottom: dueError ? 4 : 12, background: GK.tintCard, border: `1px solid ${GK.edge}`, color: K.txt }}
            value={dueText} aria-invalid={Boolean(dueError)} aria-describedby={dueError ? "task-due-error" : undefined}
            onChange={(e) => { const formatted = formatTaskDateInput(e.target.value); setDueText(formatted); setDueError(""); const parsed = parseTaskDate(formatted); setNt((n) => ({ ...n, due: parsed || "" })); }}
            onBlur={() => { if (dueText && parseTaskDate(dueText) === null) setDueError("Enter a real date as DD/MM/YYYY."); }} />
          {dueError && <div id="task-due-error" role="alert" style={{ color: K.err, fontSize: 11, marginBottom: 10 }}>{dueError}</div>}

          <SegGroup id="task-pri" label="Priority — how important it is"
            options={T_PRI} value={nt.pri} onPick={(v) => setNt((n) => ({ ...n, pri: v }))} />
          <SegGroup id="task-diff" label="Difficulty — how hard it is"
            options={T_DIFF} value={nt.diff} onPick={(v) => setNt((n) => ({ ...n, diff: v }))} />
          <SegGroup id="task-cat" label="Category — what area it belongs to"
            options={T_CATS.map((c) => [c, c])} value={nt.cat} onPick={(v) => setNt((n) => ({ ...n, cat: v }))} />

          <label htmlFor="task-desc" style={fldLbl}>Description <span style={{ color: K.muted, fontWeight: 400 }}>· optional</span></label>
          <textarea id="task-desc" rows={2} style={{ ...inpSt(), marginBottom: 14, resize: "vertical", minHeight: 54 }}
            placeholder="Any detail worth keeping"
            value={nt.desc} onChange={(e) => setNt((n) => ({ ...n, desc: e.target.value }))} />

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="b" onClick={closeForm}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: K.surf, border: `1px solid ${K.border}`, color: K.sub, fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
            <button type="submit" className="b" disabled={!nt.title.trim()}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10, background: K.acc, color: K.onAcc,
                fontSize: 12.5, fontWeight: 700, opacity: nt.title.trim() ? 1 : 0.5,
                cursor: nt.title.trim() ? "pointer" : "default",
              }}>{editId ? "Save changes" : "Add task"}</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 5, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
        {[["today", "Today"], ["upcoming", "Upcoming"], ["all", "All"], ["done", "Done"]].map(([id, lbl]) => (
          <button key={id} type="button" className="b" onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            style={{ ...tag(filter === id, K.acc), padding: "5px 13px", whiteSpace: "nowrap" }}>{lbl}</button>
        ))}
      </div>

      {/* List — one grouped surface, hairline rows. Rows stay compact: the
          meta chips are words with distinct shapes (filled pill = priority,
          outlined pill = difficulty, plain text = category), so the three
          scales never have to be told apart by colour alone. */}
      {filt.length === 0 ? (
        <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 13, padding: "36px 16px" }}>
          {filter === "today" ? "Nothing due today — enjoy the quiet" : filter === "done" ? "No completed tasks yet" : "No tasks here"}
        </div>
      ) : (
        <div style={{ ...card(), padding: "6px 10px" }}>
          {filt.map((task, i) => {
            const dueLbl  = dueLabel(task.due, task.completed);
            const overdue = Boolean(task.due) && task.due < today() && !task.completed;
            const dueNow  = task.due === today() && !task.completed;
            return (
              <div key={task.id} className="task-row" style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 8px",
                borderBottom: i < filt.length - 1 ? `1px solid ${K.border}` : "none",
                opacity: task.completed ? 0.6 : 1,
              }}>
                <button type="button" className="b task-check"
                  onClick={() => toggle(task.id)}
                  aria-label={task.completed ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
                  aria-pressed={task.completed}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${task.completed ? K.ok : K.border}`,
                    background: task.completed ? K.ok : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "border-color .2s, background-color .2s",
                  }}><Check size={13} strokeWidth={3.5} color={task.completed ? "#fff" : K.muted} /></button>
                <div className="task-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{
                    fontSize: 14, color: task.completed ? K.muted : K.txt, fontWeight: 550,
                    textDecoration: task.completed ? "line-through" : "none",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{task.title}</span>
                  {task.desc && (
                    <span style={{ fontSize: 11.5, color: K.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.desc}</span>
                  )}
                </div>
                {/* Everything after the title lives in one wrapper so the row
                    can become two lines on a handset (title above, chips and
                    actions below) instead of squeezing the title to nothing
                    while the fixed-width chips keep their size. */}
                <div className="task-meta">
                {dueLbl && (
                  <span style={{
                    fontSize: 11, flexShrink: 0, fontWeight: 600,
                    color: overdue || dueNow ? K.err : K.muted,
                    background: overdue || dueNow ? K.err + "14" : "transparent",
                    padding: "2px 7px", borderRadius: 999,
                  }}>{dueLbl}</span>
                )}
                {/* Meta chips — small, but each carries its scale's name in
                    its accessible label so a screen reader (and anyone who
                    cannot see the tint) still gets the meaning. */}
                <span title={`Priority: ${priLabel(task.pri)}`} aria-label={`Priority ${priLabel(task.pri)}`}
                  style={{
                    fontSize: 10.5, fontWeight: 650, flexShrink: 0, whiteSpace: "nowrap",
                    color: PCOL()[task.pri] || K.sub, background: (PCOL()[task.pri] || K.sub) + "1F",
                    padding: "2px 8px", borderRadius: 999,
                  }}>{priLabel(task.pri)}</span>
                <span title={`Difficulty: ${diffLabel(diffOf(task))}`} aria-label={`Difficulty ${diffLabel(diffOf(task))}`}
                  style={{
                    fontSize: 10.5, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap",
                    color: K.sub, background: "transparent",
                    border: `1px solid ${K.border}`, padding: "1px 7px", borderRadius: 999,
                  }}>{diffLabel(diffOf(task))}</span>
                <span className="task-cat" style={{ fontSize: 10.5, color: K.muted, flexShrink: 0, whiteSpace: "nowrap" }}>{task.cat}</span>
                <button type="button" className="b task-act" onClick={() => openEdit(task)}
                  aria-label={`Edit task "${task.title}"`} title="Edit"
                  style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
                  <PenLine size={14} color={K.muted} />
                </button>
                <button type="button" className="b task-act" onClick={() => del(task.id)}
                  aria-label={`Delete task "${task.title}"`} title="Delete"
                  style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
                  <X size={15} color={K.muted} />
                </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════════════════
const MNS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MNL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DNS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

/**
 * Turn a Calendar failure code into something a person can act on. An
 * undeployed function, a revoked grant and an expired session are three
 * different problems with three different fixes — echoing the raw id (or the
 * Supabase {"code":"NOT_FOUND"} envelope) hides which one it is.
 * Shared by the Calendar screen and the Settings card so both say the same
 * thing about the same state.
 */
const gcalWhy = (e) => e === "function_missing" ? "The Calendar function isn't deployed yet (see SETUP.md)."
  : e === "not_connected" ? "Google Calendar isn't connected."
  : e === "not_configured" ? "Google sign-in isn't configured on this build."
  : e === "signed_out" ? "Sign in first, then connect Google Calendar."
  : e === "unauthorized" ? "That sign-in has expired — sign in again."
  : String(e);

function Cal({ user }) {
  const [tasks,   setTasks]   = useState(user.tasks || []);
  const [cur,     setCur]     = useState(new Date());
  const [sel,     setSel]     = useState(() => new Date().getDate());
  useEffect(() => {
    S.get(`u:${user.un}`).then((u) => { if (u?.tasks) setTasks(u.tasks); });
  }, [user.un]);

  const Y = cur.getFullYear(), M = cur.getMonth();
  const fd = new Date(Y, M, 1).getDay();
  const dm = new Date(Y, M + 1, 0).getDate();
  const ds  = (d) => `${Y}-${pad2(M + 1)}-${pad2(d)}`;
  const dt  = (d) => tasks.filter((t) => t.due === ds(d));
  const now = new Date();

  const st = sel ? dt(sel) : [];

  return (
    <div className="npage">
      <div style={{ color: K.sub, fontSize: 12, marginBottom: 12 }}>Tasks scheduled in Tasks appear on their assigned day.</div>
      {/* Month header — Apple style: big title + chevrons + Today.
          Wraps (and scales its title down) rather than running off the right
          edge: a fixed 28px title plus the Today/chevron cluster is wider than
          a 320px phone has room for, and the shell clips overflow. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, rowGap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: "clamp(21px, 6.4vw, 28px)", fontWeight: 800, color: K.txt, letterSpacing: -0.5, minWidth: 0 }}>
          {MNL[M]} <span style={{ color: K.sub, fontWeight: 600 }}>{Y}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="b" onClick={() => { setCur(new Date(Y, M, 1)); setSel(now.getDate()); }}
            style={{
              padding: "5px 13px", borderRadius: 999, background: K.surf, color: K.acc,
              border: `1px solid ${K.border}`, fontSize: 12, fontWeight: 600,
            }}>Today</button>
          <div style={{ display: "flex", background: K.surf, borderRadius: 999, padding: 2, border: `1px solid ${K.border}` }}>
            <button type="button" className="b" onClick={() => setCur(new Date(Y, M - 1, 1))}
              aria-label="Previous month"
              style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={17} color={K.sub} />
            </button>
            <button type="button" className="b" onClick={() => setCur(new Date(Y, M + 1, 1))}
              aria-label="Next month"
              style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronRight size={17} color={K.sub} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...softPanel(), padding: "16px 14px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
          {DNS.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 10, color: K.muted, padding: "3px 0", fontWeight: 700 }}>{d}</div>)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", rowGap: 2, columnGap: 4, marginBottom: 6 }}>
          {Array(fd).fill(null).map((_, i) => <div key={`e${i}`} />)}
          {Array(dm).fill(null).map((_, i) => {
            const d   = i + 1;
            const dts = dt(d);
            const isT = now.getDate() === d && now.getMonth() === M && now.getFullYear() === Y;
            const isS = sel === d;
            return (
              <button key={d} type="button" className="b" onClick={() => setSel(isS ? null : d)}
                aria-pressed={isS}
                aria-label={`${MNL[M]} ${d}${dts.length ? ", " + dts.length + " task" + (dts.length === 1 ? "" : "s") : ""}`}
                style={{
                  height: 56, borderRadius: 10, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 2,
                  background: "transparent", transition: "all .15s",
                }}>
                <span style={{
                  // min(100%, 32px) + aspect-ratio: a fixed 32px circle set the
                  // grid column's minimum, so on a narrow phone (a 320px SE,
                  // where a week row has ~28px per cell) the day numbers pushed
                  // the whole month grid past its panel and got clipped.
                  width: "min(100%, 32px)", aspectRatio: "1 / 1", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isS ? K.acc : "transparent",
                  boxShadow: isT && !isS ? `inset 0 0 0 1.5px ${K.acc}` : "none",
                  fontSize: 14, fontWeight: isS || isT ? 700 : 500,
                  color: isS ? "#fff" : isT ? K.acc : K.txt,
                }}>{d}</span>
                <span style={{ display: "flex", gap: 2, height: 3 }}>
                  {/* Dots mark tasks assigned to this day in Tasks. */}
                  {dts.slice(0, 3).map((t, i) => (
                    <span key={`t${i}`} style={{ width: 3.5, height: 3.5, borderRadius: "50%", background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {sel && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: K.txt, letterSpacing: -0.3 }}>
              {MNL[M]} {sel}
              {st.length > 0 && <span style={{ color: K.sub, fontWeight: 500, marginLeft: 6, fontSize: 13 }}>{st.length} task{st.length === 1 ? "" : "s"}</span>}
            </div>
          </div>
          <div style={{ ...softPanel(), padding: "6px 14px" }}>
            {st.length === 0 ? (
              <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: "16px 0" }}>
                Nothing planned for this day
              </div>
            ) : (
              <>
                {/* North tasks first — the product's own objects. */}
                {st.map((t) => (
                  <div key={t.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                    borderBottom: `1px solid ${K.border}`,
                  }}>
                    <div style={{ width: 3, height: 20, borderRadius: 2, flexShrink: 0, background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
                    <div style={{ flex: 1, fontSize: 13.5, color: t.completed ? K.muted : K.txt, textDecoration: t.completed ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: K.acc, background: K.accDim, padding: "2px 7px", borderRadius: 999, flexShrink: 0 }}>TASK</span>
                    <div style={{ fontSize: 11, color: K.muted, flexShrink: 0 }}>{t.cat}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// APPS / TRACKER
// ══════════════════════════════════════════════════════════════════════════
const ICS = ["📱","🌐","📺","🎮","📸","💬","🎵","📧","🛒","📰","🐦","📷"];

// Usage numbers here stay deliberately manual, and the screen says so: a web
// page cannot read another app's screen time. The rules that clients genuinely
// enforce live in the Blocking screen, which renders this section beneath them.
function AppUsage({ user }) {
  const [apps,    setApps]    = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [na,      setNa]      = useState({ name: "", icon: "📱", limit: 60 });

  useEffect(() => {
    S.get(`u:${user.un}`).then((u) => {
      if (!u?.apps) return;
      const td   = today();
      const apps = u.apps.map((a) => a.lastD !== td ? { ...a, used: 0, lastD: td } : a);
      setApps(apps);
    });
  }, [user.un]);

  const persist = async (updated) => {
    setApps(updated);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, apps: updated });
  };

  const addApp = async () => {
    if (!na.name.trim()) return;
    await persist([...apps, { id: uid(), name: na.name.trim(), icon: na.icon, limit: parseInt(na.limit) || 60, used: 0, blocked: false, lastD: today() }]);
    setNa({ name: "", icon: "📱", limit: 60 });
    setShowAdd(false);
  };

  const log = (id, m) => persist(apps.map((a) => a.id === id ? { ...a, used: Math.max(0, (a.used || 0) + m) } : a));
  const tog = (id) => persist(apps.map((a) => a.id === id ? { ...a, blocked: !a.blocked } : a));
  const del = (id) => persist(apps.filter((a) => a.id !== id));

  const total = apps.reduce((s, a) => s + (a.used || 0), 0);
  const over  = apps.filter((a) => (a.used || 0) >= a.limit).length;

  return (
    <div className="npage">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ ...sectionTitle(), fontSize: 17, margin: 0 }}>Screen time</h2>
        <button type="button" className="b" onClick={() => setShowAdd((v) => !v)}
          aria-label={showAdd ? "Close add app" : "Track an app"}
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: showAdd ? K.card : K.acc,
            border: showAdd ? `1px solid ${K.border}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}>{showAdd ? <X size={18} color={K.sub} /> : <Plus size={18} color="#fff" />}</button>
      </div>
      <div style={{ fontSize: 12, color: K.sub, marginBottom: 20 }}>
        {total}m used today, logged manually ·{" "}
        {over > 0
          ? <span style={{ color: K.err }}>{over} over limit</span>
          : <span style={{ color: K.ok }}>all within limits</span>}
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ ...card(), marginBottom: 16 }}>
          <input style={{ ...inpSt(), marginBottom: 10 }} placeholder="App name (e.g. Instagram)"
            value={na.name} onChange={(e) => setNa((n) => ({ ...n, name: e.target.value }))} />
          <div style={{ fontSize: 11, color: K.sub, marginBottom: 6 }}>Icon</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {ICS.map((ic) => (
              <button key={ic} type="button" className="b" onClick={() => setNa((n) => ({ ...n, icon: ic }))}
                aria-pressed={na.icon === ic}
                aria-label={`Use ${ic} icon`}
                style={{
                  width: 34, height: 34, borderRadius: 8, fontSize: 18,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: na.icon === ic ? K.accDim : K.surf,
                  border: `1px solid ${na.icon === ic ? K.acc : K.border}`,
                }}>{ic}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: K.sub }}>Daily limit:</div>
            <input type="number" style={{ ...inpSt(), width: 70 }}
              value={na.limit} onChange={(e) => setNa((n) => ({ ...n, limit: e.target.value }))} />
            <div style={{ fontSize: 12, color: K.sub }}>min/day</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="b" onClick={() => setShowAdd(false)}
              style={{ flex: 1, padding: "8px 0", borderRadius: 8, background: K.surf, color: K.sub, fontSize: 12 }}>Cancel</button>
            <button type="button" className="b" onClick={addApp}
              style={{ flex: 2, padding: "8px 0", borderRadius: 8, background: K.acc, color: K.onAcc, fontSize: 12, fontWeight: 600 }}>Track app</button>
          </div>
        </div>
      )}

      {apps.length === 0 && !showAdd && (
        <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: 44 }}>
          Add apps to track daily screen time
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {apps.map((app) => {
          const used = app.used || 0;
          const pct  = Math.min((used / app.limit) * 100, 100);
          const ov   = used >= app.limit;
          const bc   = ov ? K.err : pct > 70 ? K.warn : K.ok;
          return (
            <div key={app.id} style={{
              ...card(), border: `1px solid ${app.blocked ? K.err + "50" : ov ? K.warn + "30" : K.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 26 }}>{app.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: K.txt, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                    {app.name}
                    {app.blocked && <span style={{ fontSize: 9, color: K.err, background: K.err + "20", padding: "1px 5px", borderRadius: 10 }}>BLOCKED</span>}
                    {ov && !app.blocked && <span style={{ fontSize: 9, color: K.warn, background: K.warn + "20", padding: "1px 5px", borderRadius: 10 }}>OVER LIMIT</span>}
                  </div>
                  <div style={{ fontSize: 11, color: K.sub }}>{used}m used of {app.limit}m limit</div>
                </div>
                <button type="button" className="b" onClick={() => tog(app.id)}
                  aria-pressed={app.blocked}
                  aria-label={app.blocked ? `Unblock ${app.name}` : `Block ${app.name}`}
                  style={{ ...tag(app.blocked, K.err), fontSize: 11, padding: "3px 9px" }}>
                  {app.blocked ? "Unblock" : "Block"}
                </button>
                <button type="button" className="b" onClick={() => del(app.id)}
                  aria-label={`Remove ${app.name} from tracker`}
                  style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}><X size={15} color={K.muted} /></button>
              </div>
              <div style={{ height: 4, background: K.border, borderRadius: 2, marginBottom: 10 }}>
                <div style={{ height: "100%", borderRadius: 2, background: bc, width: `${pct}%`, maxWidth: "100%", transition: "width .4s" }} />
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {[5, 15, 30, 60].map((m) => (
                  <button key={m} type="button" className="b"
                    onClick={() => log(app.id, m)}
                    aria-label={`Add ${m} minutes to ${app.name}`}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 8,
                      background: K.surf, color: K.sub, fontSize: 11,
                      border: `1px solid ${K.border}`,
                    }}>+{m}m</button>
                ))}
                <button type="button" className="b" onClick={() => log(app.id, -15)}
                  aria-label={`Remove 15 minutes from ${app.name}`}
                  style={{
                    padding: "6px 8px", borderRadius: 8,
                    background: K.surf, color: K.muted, fontSize: 11,
                    border: `1px solid ${K.border}`,
                  }}>−15</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Real website usage on the Flow page, from the same source as the Home
 * strip: the `usage_records` rows the extension uploads (owner-scoped, RLS,
 * domains + seconds only). DistractionStrip summarises the last 4 weeks
 * against blocked domains; this one is Flow's window — the last 7 days,
 * where "is this rule earning its place" is decided. Renders nothing when
 * the extension has not recorded anything: an empty list is the truth there,
 * never a placeholder.
 */
const formatFlowDuration = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
  return `${remainder}s`;
};

function FlowUsage({ user, onTargets, hiddenSites = [], onToggleHidden }) {
  const currentDay = new Date().toISOString().slice(0, 10);
  const [d, setD] = useState(null);
  const [source, setSource] = useState("website");
  const [hiddenDraft, setHiddenDraft] = useState("");
  const [rangeFrom, setRangeFrom] = useState(currentDay);
  const [rangeTo, setRangeTo] = useState(currentDay);
  useEffect(() => {
    let dead = false;
    const refresh = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const chartSince = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
        const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
        const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
        const since = from < chartSince ? from : chartSince;
        const [extension, response] = await Promise.all([
          readExtensionUsage(),
          supabaseConfigured && supabase
            ? supabase.from("usage_records").select("day, kind, name, seconds").in("kind", ["website", "app"]).gte("day", since).lte("day", today)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (dead) return;
        const rows = response.error ? [] : response.data || [];
        const byDomain = new Map();
        const byDay = new Map();
        const appByName = new Map();
        const appByDay = new Map();
        const websitesByDate = new Map();
        const appsByDate = new Map();
        for (const r of rows) {
          if (r.kind === "app") {
            const name = String(r.name || "").trim();
            const secs = Math.max(0, Math.floor(Number(r.seconds)));
            const day = String(r.day || "");
            if (!name || secs <= 0 || day > today) continue;
            appByDay.set(day, (appByDay.get(day) || 0) + secs);
            const dayApps = appsByDate.get(day) || new Map();
            dayApps.set(name, (dayApps.get(name) || 0) + secs);
            appsByDate.set(day, dayApps);
            const app = appByName.get(name) ?? { domain: name, seconds: 0 };
            app.seconds += secs;
            appByName.set(name, app);
            continue;
          }
          const host = String(r.name || "").trim().toLowerCase().replace(/^www\./, "");
          const secs = Math.max(0, Math.floor(Number(r.seconds)));
          const day = String(r.day || "");
          if (!host || isHiddenUsageSite(host, hiddenSites) || secs <= 0 || day >= today) continue;
          byDay.set(day, (byDay.get(day) || 0) + secs);
          const daySites = websitesByDate.get(day) || new Map();
          daySites.set(host, (daySites.get(host) || 0) + secs);
          websitesByDate.set(day, daySites);
          const e = byDomain.get(host) ?? { domain: host, seconds: 0 };
          e.seconds += secs;
          byDomain.set(host, e);
        }
        const todayRows = extension.installed ? extension.usageToday || [] : [];
        const visibleTodayRows = todayRows.filter((e) => !isHiddenUsageSite(e.host, hiddenSites));
        const todaySecs = visibleTodayRows.reduce((n, e) => n + (Number(e.seconds) || Number(e.minutes) * 60 || 0), 0);
        for (const e of visibleTodayRows) {
          const host = String(e.host || "").trim().toLowerCase().replace(/^www\./, "");
          const seconds = Number(e.seconds) || Number(e.minutes) * 60 || 0;
          if (!host || seconds <= 0) continue;
          const prev = byDomain.get(host) ?? { domain: host, seconds: 0 };
          prev.seconds += seconds;
          byDomain.set(host, prev);
          const todaySites = websitesByDate.get(today) || new Map();
          todaySites.set(host, (todaySites.get(host) || 0) + seconds);
          websitesByDate.set(today, todaySites);
        }
        byDay.set(today, todaySecs);
        const aggregateRange = (dated) => {
          const totals = new Map();
          let trackedDays = 0;
          for (const [day, entries] of dated) {
            if (day < from || day > to) continue;
            if ([...entries.values()].some((seconds) => seconds > 0)) trackedDays += 1;
            for (const [name, seconds] of entries) totals.set(name, (totals.get(name) || 0) + seconds);
          }
          return { totals, trackedDays };
        };
        const websiteRange = aggregateRange(websitesByDate);
        const appRange = aggregateRange(appsByDate);
        const selectedDays = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1);
        const websiteRangeTargets = [...websiteRange.totals].map(([domain, seconds]) => ({ domain, seconds })).sort((a, b) => b.seconds - a.seconds);
        const appRangeTargets = [...appRange.totals].map(([domain, seconds]) => ({ domain, seconds })).sort((a, b) => b.seconds - a.seconds);
        const daily = Array.from({ length: 7 }, (_, i) => {
          const date = new Date(`${today}T00:00:00.000Z`);
          date.setUTCDate(date.getUTCDate() - (6 - i));
          const day = date.toISOString().slice(0, 10);
          return {
            day,
            label: date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
            seconds: byDay.get(day) || 0,
            minutes: Math.round((byDay.get(day) || 0) / 60),
          };
        });
        const desktopDaily = daily.map((item) => ({ ...item, seconds: appByDay.get(item.day) || 0, minutes: Math.round((appByDay.get(item.day) || 0) / 60) }));
        const websiteTargets = [...byDomain.values()].sort((a, b) => b.seconds - a.seconds)
          .map((e) => ({ kind: "website", target: e.domain, domain: e.domain, seconds: e.seconds }));
        const appTargets = [...appByName.values()].sort((a, b) => b.seconds - a.seconds)
          .map((e) => ({ kind: "app", target: e.domain, domain: e.domain, seconds: e.seconds }));
        setD({
          installed: Boolean(extension.installed),
          todaySeconds: todaySecs,
          totalSeconds: websiteRangeTargets.reduce((sum, item) => sum + item.seconds, 0),
          todayMinutes: Math.round(todaySecs / 60),
          totalMinutes: Math.round(websiteRangeTargets.reduce((sum, item) => sum + item.seconds, 0) / 60),
          days: websiteRange.trackedDays,
          rangeFrom: from,
          rangeTo: to,
          rangeDays: selectedDays,
          daily,
          desktopTodaySeconds: appByDay.get(today) || 0,
          desktopTotalSeconds: appRangeTargets.reduce((sum, item) => sum + item.seconds, 0),
          desktopTodayMinutes: Math.round((appByDay.get(today) || 0) / 60),
          desktopTotalMinutes: Math.round(appRangeTargets.reduce((sum, item) => sum + item.seconds, 0) / 60),
          desktopDays: appRange.trackedDays,
          desktopDaily,
          desktopTop: appRangeTargets.map((e) => ({ ...e, minutes: Math.floor(e.seconds / 60) })),
          top: websiteRangeTargets.map((e) => ({ ...e, minutes: Math.floor(e.seconds / 60) })),
          blockedToday: extension.installed ? extension.blockedToday || [] : [],
          limits: extension.installed ? extension.usageLimits || [] : [],
        });
        onTargets?.([...websiteTargets, ...appTargets]);
      } catch {
        if (!dead) setD({ installed: false, todayMinutes: 0, totalMinutes: 0, days: 0, daily: [], top: [], desktopTodayMinutes: 0, desktopTotalMinutes: 0, desktopDaily: [], desktopTop: [], blockedToday: [], limits: [] });
      }
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60000);
    return () => {
      dead = true;
      clearInterval(timer);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user.un, hiddenSites, rangeFrom, rangeTo, onTargets]);

  if (!d) return null;
  const blockedAttempts = d.blockedToday.reduce((n, e) => n + (Number(e.count) || 0), 0);
  const isWeb = source === "website";
  const daily = isWeb ? d.daily || [] : d.desktopDaily || [];
  const todaySeconds = isWeb ? d.todaySeconds : d.desktopTodaySeconds;
  const totalSeconds = isWeb ? d.totalSeconds : d.desktopTotalSeconds;
  const averageSeconds = Math.round(totalSeconds / Math.max(1, d.rangeDays || 1));
  const chartTotalSeconds = daily.reduce((sum, item) => sum + item.seconds, 0);
  const chartPoints = daily.map((day, index) => ({
    ...day,
    x: 42 + index * (560 / Math.max(1, daily.length - 1)),
    y: 178 - Math.min(145, (day.seconds / Math.max(1, ...daily.map((item) => item.seconds))) * 145),
  }));
  const chartPath = chartPoints.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const allTargets = [
    ...(d.top || []).map((item) => ({ ...item, kind: "Website" })),
    ...(d.desktopTop || []).map((item) => ({ ...item, kind: "Desktop app" })),
  ].sort((a, b) => b.seconds - a.seconds);
  const palette = [K.acc, "#64748b", "#0f766e", "#94a3b8", "#475569", "#cbd5e1"];
  const pie = (title, entries, empty) => {
    const shown = entries.slice(0, 6);
    const total = shown.reduce((sum, item) => sum + item.seconds, 0);
    let offset = 0;
    const slices = shown.map((item, index) => {
      const start = offset;
      offset += (item.seconds / (total || 1)) * 100;
      return `${palette[index % palette.length]} ${start}% ${offset}%`;
    });
    return <section className="flow-pie-panel" aria-label={title}>
      <div className="flow-pie-title">{title}</div>
      {shown.length ? <div className="flow-pie-content">
        <div className="flow-pie" role="img" aria-label={`${title}: ${shown.map((item) => `${item.domain}, ${Math.round(item.seconds / total * 100)} percent`).join("; ")}`} style={{ background: `conic-gradient(${slices.join(", ")})` }}><span>{fmt(total)}</span></div>
        <div className="flow-pie-legend">{shown.map((item, index) => <div key={item.domain} title={item.domain}><i style={{ background: palette[index % palette.length] }} /><span>{item.domain}</span><small>{Math.round(item.seconds / total * 100)}%</small></div>)}</div>
      </div> : <p className="flow-empty">{empty}</p>}
    </section>;
  };
  const fmt = formatFlowDuration;
  return (
    <div className="flow-analytics">
      <div className="flow-analytics-header">
        <div><h3>{isWeb ? "Website usage" : "Desktop app usage"}</h3><p>{isWeb ? "Browser activity collected by NORTH Flow extension" : "Foreground app activity from NORTH Desktop"}</p></div>
        {[ ["website", "Web"], ["desktop", "Desktop"] ].map(([id, label]) => (
          <button key={id} type="button" className="b" aria-pressed={source === id} onClick={() => setSource(id)}
            style={{ padding: "7px 13px", fontSize: 11, borderRadius: 20, color: source === id ? K.txt : K.sub, background: source === id ? `${K.acc}30` : "transparent", border: `1px solid ${source === id ? K.acc + "88" : K.border}` }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ color: K.sub, fontSize: 10 }}>From<input type="date" value={rangeFrom} max={currentDay} onChange={(event) => setRangeFrom(event.target.value || currentDay)} style={{ ...inpSt(), display: "block", width: 150, marginTop: 4, padding: "7px 9px" }} /></label>
        <label style={{ color: K.sub, fontSize: 10 }}>To<input type="date" value={rangeTo} max={currentDay} onChange={(event) => setRangeTo(event.target.value || currentDay)} style={{ ...inpSt(), display: "block", width: 150, marginTop: 4, padding: "7px 9px" }} /></label>
        <button type="button" className="b" onClick={() => { setRangeFrom(currentDay); setRangeTo(currentDay); }} style={{ ...tag(rangeFrom === currentDay && rangeTo === currentDay, K.acc), padding: "8px 12px" }}>Today</button>
        <button type="button" className="b" onClick={() => { const date = new Date(`${currentDay}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); const day = date.toISOString().slice(0, 10); setRangeFrom(day); setRangeTo(day); }} style={{ ...tag(false, K.acc), padding: "8px 12px" }}>Yesterday</button>
        <span style={{ color: K.sub, fontSize: 11 }}>{d.rangeFrom === d.rangeTo ? d.rangeFrom : `${d.rangeFrom} → ${d.rangeTo}`} · {fmt(totalSeconds)}</span>
      </div>
      <div className="flow-analytics-top">
        <section className="flow-time-chart">
          <div className="flow-chart-title"><strong>Usage time</strong><span>{fmt(chartTotalSeconds)} · last 7 days</span></div>
          <svg viewBox="0 0 640 230" role="img" aria-label={`Daily ${isWeb ? "website" : "desktop app"} usage, last seven days: ${daily.map((item) => `${item.label} ${fmt(item.seconds)}`).join(", ")}`}>
            {[0, 1, 2, 3].map((line) => <line key={line} x1="42" x2="602" y1={178 - line * 48} y2={178 - line * 48} stroke={K.border} strokeWidth="1" />)}
            <path d={chartPath} fill="none" stroke={K.acc} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            {chartPoints.map((point) => <g key={point.day}><circle cx={point.x} cy={point.y} r="5" fill={K.acc} /><text x={point.x} y="210" textAnchor="middle" fill={K.sub} fontSize="12">{point.label}</text><title>{point.day}: {fmt(point.seconds)}</title></g>)}
          </svg>
          <p className="flow-chart-note">Daily totals · exact hourly sessions are not currently collected.</p>
        </section>
        <div className="flow-stat-grid">
          {[["TODAY", fmt(todaySeconds)], ["AVERAGE DAILY", fmt(averageSeconds)], ["SELECTED TOTAL", fmt(totalSeconds)], ["DAYS WITH USAGE", isWeb ? d.days : d.desktopDays || 0]].map(([label, value]) => <div className="flow-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
      </div>
      <div className="flow-analytics-lower">
        <section className="flow-device-list">
          <h4>All devices & websites</h4>
          {allTargets.length ? allTargets.map((item) => <div className="flow-target-row" key={`${item.kind}-${item.domain}`}><div><strong>{item.domain}</strong><small>{item.kind}</small></div><span>{fmt(item.seconds)}</span>{item.kind === "Website" && <button type="button" className="b" onClick={() => onToggleHidden?.(item.domain)} aria-label={`Hide ${item.domain} from usage reports`} title="Hide from usage reports" style={{ color: K.sub, padding: 5 }}><EyeOff size={14} /></button>}</div>) : <div className="flow-empty">{isWeb ? "No browser usage recorded yet." : "No usage recorded yet. Run North Desktop and the browser extension to collect activity."}</div>}
          {isWeb && <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${K.border}` }}>
            <h4 style={{ margin: "0 0 4px", color: K.txt, fontSize: 13 }}>Hidden websites</h4>
            <p style={{ margin: "0 0 9px", color: K.sub, fontSize: 10.5 }}>Excluded from website totals and charts; this preference syncs with your North account.</p>
            <form onSubmit={(event) => { event.preventDefault(); const host = normalizeHost(hiddenDraft); if (host) { onToggleHidden?.(host); setHiddenDraft(""); } }} style={{ display: "flex", gap: 7 }}>
              <input aria-label="Website to hide from usage" value={hiddenDraft} onChange={(event) => setHiddenDraft(event.target.value)} placeholder="youtube.com" style={{ ...inpSt(), flex: 1, minWidth: 0, padding: "8px 10px", fontSize: 11 }} />
              <button type="submit" className="b" disabled={!normalizeHost(hiddenDraft)} style={{ padding: "7px 12px", borderRadius: 9, background: K.acc, color: K.onAcc, fontSize: 11, fontWeight: 600 }}>Hide</button>
            </form>
            {hiddenSites.length ? hiddenSites.map((host) => <div className="flow-target-row" key={host}><div><strong>{host}</strong><small>Excluded from usage reports</small></div><button type="button" className="b" onClick={() => onToggleHidden?.(host)} aria-label={`Unhide ${host}`} style={{ color: K.acc, padding: 5 }}><Eye size={14} /> Show</button></div>) : <div className="flow-empty" style={{ padding: "9px 0 0" }}>No hidden websites.</div>}
          </div>}
        </section>
        <div className="flow-pie-grid">
          {pie("Desktop app usage", d.desktopTop || [], "No desktop app data yet. North Desktop collects this.")}
          {pie("Website usage", d.top || [], "No website data yet. North Flow extension collects this.")}
        </div>
      </div>
      {isWeb && d.limits?.length > 0 && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: K.sub, marginBottom: 3 }}>DAILY LIMITS · THIS BROWSER</div>
        {d.limits.map((limit) => (
          <div key={limit.target} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", fontSize: 11 }}>
            <span style={{ color: K.txt }}>{limit.target}</span>
            <span style={{ color: limit.reached ? K.err : K.sub }}>{fmt(limit.usedSeconds)} / {fmt(limit.dailyLimitMinutes * 60)}{limit.reached ? " · blocked" : ""}</span>
          </div>
        ))}
      </div>}
      <div style={{ fontSize: 10, color: K.sub, marginTop: 8 }}>{d.installed ? "Browser stats are local to this browser; completed-day totals sync to your North account." : "Browser extension not detected in this browser."} Desktop totals come from NORTH Desktop.</div>
      {isWeb && blockedAttempts > 0 && (
        <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${K.border}`, fontSize: 11.5, color: K.txt }}>
          {blockedAttempts} blocked attempt{blockedAttempts === 1 ? "" : "s"} today
          {d.blockedToday.slice(0, 3).map((e) => <span key={e.host} style={{ color: K.sub }}> · {e.host} ({e.count})</span>)}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BLOCKING — websites, applications, schedules
// ══════════════════════════════════════════════════════════════════════════
// One screen, one data model (src/shared/blocking.js — the same file the
// extension, desktop and mobile clients use). This page CONFIGURES rules and
// reports honestly where each kind is enforced: the browser extension blocks
// websites for real, the desktop app ends blocked applications. A web page can
// do neither, so it never claims to.

/** Small switch used by the rule/schedule rows (mirrors the timer's toggles). */
const Toggle = ({ on, onToggle, label }) => (
  <button type="button" className="b" role="switch" aria-checked={on} onClick={onToggle}
    aria-label={`${on ? "Turn off" : "Turn on"} ${label}`}
    style={{
      width: 40, height: 24, borderRadius: 12, position: "relative", flexShrink: 0,
      background: on ? K.ok : K.muted + "55", transition: "background .2s",
    }}>
    <span aria-hidden="true" style={{
      position: "absolute", top: 2, left: on ? 18 : 2, width: 20, height: 20,
      borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)",
      transition: "left .18s ease",
    }} />
  </button>
);

/**
 * The enforcement layer, stated rather than asserted.
 *
 * This page configures rules; the browser extension is the client that can
 * actually stop a site from loading. Instead of describing that in prose and
 * hoping the reader believes it, this card asks the extension — through the
 * read-only channel in lib/extension.js — and reports what it finds: installed
 * or not, which version, how many domains it is enforcing right now, and
 * whether a focus session is running. When it cannot reach one it says which
 * check failed, which is the difference between "you haven't installed it" and
 * "this browser refused the handshake".
 */
function ExtensionCard() {
  const [state, setState] = useState({ checking: true });
  const [help, setHelp] = useState(false);
  const [draft, setDraft] = useState(() => extensionId());
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const check = () => pingExtension().then((r) => setState({ checking: false, ...r }));

  useEffect(() => {
    let dead = false;
    const tick = () => pingExtension().then((r) => { if (!dead) setState({ checking: false, ...r }); });
    tick();
    // The extension's worker sleeps when idle, so the answer is refreshed
    // rather than fetched once — a stale "not detected" would be a lie.
    const iv = setInterval(tick, 15000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  const on = Boolean(state.installed);
  const linked = Boolean(state.signedIn);
  const why = {
    no_channel: "This page can't reach extensions — open North on a listed origin.",
    timeout: "The extension didn't answer in time.",
    no_receiver: "Not installed in this browser.",
  }[state.reason] || "";

  return (
    <div style={{ ...card(), marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sectionTitle() }}>Browser extension</div>
          <div style={{ fontSize: 11.5, color: K.sub, marginTop: 3, lineHeight: 1.5 }}>
            {state.checking
              ? "Checking this browser…"
              : on && linked
                ? `Enforcing ${state.blocking} site${state.blocking === 1 ? "" : "s"}${state.focus ? " · Focus Mode is on" : ""} · v${state.version}`
                : on
                  ? "Installed, but not connected to your North account. Choose Connect to North in the extension to sync your rules."
                : `Rules are saved to your account, but nothing is enforcing them in this browser.${why ? ` ${why}` : ""}`}
          </div>
        </div>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, padding: "3px 8px", borderRadius: 20, flexShrink: 0,
          color: on && linked ? K.ok : on ? K.warn : K.muted, background: (on && linked ? K.ok : on ? K.warn : K.muted) + "20",
        }}>{state.checking ? "CHECKING" : !on ? "NOT DETECTED" : linked ? "ENFORCING" : "NOT LINKED"}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="b" disabled={syncing}
          onClick={async () => {
            setSyncing(true); setSyncMessage("");
            const result = await requestExtensionSync();
            await check();
            setSyncMessage(result?.synced ? "Rules synced and applied in this browser." : result?.reason === "signed_out" ? "Sign into the same North account in the extension to sync rules." : `Sync not completed: ${result?.reason || "extension did not confirm account sync"}.`);
            setSyncing(false);
          }}
          style={{ padding: "7px 14px", borderRadius: 9, background: K.acc, color: K.onAcc, fontSize: 12, fontWeight: 600 }}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button type="button" className="b" aria-expanded={help}
          onClick={() => setHelp((v) => !v)}
          style={{ padding: "7px 14px", borderRadius: 9, background: K.surf, color: K.sub, fontSize: 12 }}>
          {help ? "Hide setup" : "Set up the extension"}
        </button>
      </div>
      {syncMessage && <div role="status" style={{ marginTop: 8, color: syncMessage.startsWith("Rules synced") ? K.ok : K.warn, fontSize: 11 }}>{syncMessage}</div>}

      {help && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: K.sub, lineHeight: 1.8 }}>
          <div>1. Open <code>chrome://extensions</code> (or <code>edge://extensions</code>) and turn on Developer mode.</div>
          <div>2. Choose “Load unpacked” and pick the <code>apps/extension</code> folder of this project.</div>
          <div>3. Sign in to North on this website, then choose <strong>Connect to North</strong> in the extension. Your account limits and blocking rules will then sync to this browser.</div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: K.muted }}>
            Blocking happens in the browser, so it keeps working while North is closed.
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
            <input style={{ ...inpSt(), flex: 1 }} value={draft} aria-label="Extension id"
              placeholder={EXTENSION_ID} onChange={(e) => setDraft(e.target.value)} />
            <button type="button" className="b"
              onClick={() => { setExtensionId(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); check(); }}
              style={{ padding: "8px 14px", borderRadius: 9, background: K.surf, color: K.sub, fontSize: 12 }}>
              {saved ? "Saved" : "Use id"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: K.muted, marginTop: 6 }}>
            {extensionChannelOpen()
              ? `Default id ${EXTENSION_ID} — paste another one if you installed from a store.`
              : "This page cannot reach extensions: Chrome only injects the channel on a listed origin."}
          </div>
        </div>
      )}
    </div>
  );
}

function Blocking({ user }) {
  const [blocking, setBlocking] = useState(() => normalizeState(user.blocking || defaultBlocking()));
  const [hiddenUsageSites, setHiddenUsageSites] = useState(() => Array.isArray(user.hiddenUsageSites) ? user.hiddenUsageSites : []);
  const [observedTargets, setObservedTargets] = useState(() => (user.apps || [])
    .map((app) => ({ kind: "app", target: String(app.name || app).trim(), seconds: 0 }))
    .filter((app) => app.target));
  const [showLimitCreate, setShowLimitCreate] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState([]);
  const [createMode, setCreateMode] = useState("daily");
  const [createHours, setCreateHours] = useState(0);
  const [createMinutes, setCreateMinutes] = useState(30);
  const [createName, setCreateName] = useState("");
  const [createDays, setCreateDays] = useState([...WORKDAYS]);
  const [createStart, setCreateStart] = useState("09:00");
  const [createEnd, setCreateEnd] = useState("17:00");
  const [createSearch, setCreateSearch] = useState("");
  const [createError, setCreateError] = useState("");
  const [limitSyncNote, setLimitSyncNote] = useState("");
  const [, bumpClock] = useState(0); // the verdict depends on the wall clock
  const [showSite, setShowSite] = useState(false);
  const [site, setSite] = useState("");
  const [siteWhen, setSiteWhen] = useState("always");
  const [siteScheduleIds, setSiteScheduleIds] = useState([]);
  const [showAppRule, setShowAppRule] = useState(false);
  const [appName, setAppName] = useState("");
  const [appWhen, setAppWhen] = useState("always");
  const [appScheduleIds, setAppScheduleIds] = useState([]);
  const [showSched, setShowSched] = useState(false);
  const [draft, setDraft] = useState(() => newSchedule({ name: "Work hours" }));
  const [err, setErr] = useState("");
  // A schedule can start, or a focus session end, while this screen is open —
  // so refresh the status instead of showing a stale verdict.
  useEffect(() => {
    const id = setInterval(() => bumpClock((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setHiddenUsageSites(Array.isArray(user.hiddenUsageSites) ? user.hiddenUsageSites : []);
  }, [user.un, user.hiddenUsageSites]);
  useEffect(() => {
    const site = normalizeHost(new URLSearchParams(window.location.search).get("site") || "");
    if (site) {
      setSelectedTargets([{ kind: "website", target: site, seconds: 0 }]);
      setShowLimitCreate(true);
    }
  }, []);

  const now = Date.now();
  const verdict = evaluateBlocking(blocking, now);
  const grouped = rulesByKind(blocking);
  const tracked = user.apps || [];

  const persist = async (next) => {
    setBlocking(next);
    setLimitSyncNote("Saving to your account…");
    const u = (await S.get(PROFILE_KEY(user.un))) || {};
    await S.set(PROFILE_KEY(user.un), { ...u, blocking: next });
    // Push first, then tell the extension to pull. The opposite order races
    // and lets the extension fetch the previous profile revision.
    const pushed = SYNC.ready()
      ? await SYNC.flushProfile(user.un).catch(() => ({ ok: false }))
      : { ok: false };
    if (pushed.ok) {
      const extension = await requestExtensionSync().catch(() => ({ ok: false }));
      setLimitSyncNote(extension?.ok && extension?.synced !== false
        ? "Synced to this account and extension"
        : "Saved to your account · extension will retry automatically");
    } else {
      notifyExtension("north-sync");
      setLimitSyncNote(SYNC.ready() ? "Saved here · account sync will retry automatically" : "Saved on this device");
    }
  };
  const toggleHiddenUsageSite = async (input) => {
    const host = normalizeHost(input);
    if (!host) return;
    const next = hiddenUsageSites.includes(host)
      ? hiddenUsageSites.filter((site) => site !== host)
      : [...hiddenUsageSites, host].sort();
    setHiddenUsageSites(next);
    const profileKey = PROFILE_KEY(user.un);
    const profile = (await S.get(profileKey)) || {};
    await S.set(profileKey, { ...profile, hiddenUsageSites: next });
  };
  // Rules are always created "always"-on; the focus window and schedules
  // shape when they run, so the old per-rule Always/Focus/Scheduled picker
  // (and this patch helper it used) went with the simplified UI.

  const addWebsite = async () => {
    const host = normalizeHost(site);
    if (!host) { setErr("That doesn't look like a domain — try youtube.com"); return; }
    if (blocking.rules.some((r) => r.kind === "website" && r.target === host)) {
      setErr(`${host} is already on the list.`); return;
    }
    if (siteWhen === "scheduled" && !siteScheduleIds.length) { setErr("Choose at least one schedule for this website."); return; }
    await persist(upsertRule(blocking, newRule({ kind: "website", target: host, when: siteWhen, scheduleIds: siteWhen === "scheduled" ? siteScheduleIds : [] })));
    setSite(""); setShowSite(false); setSiteWhen("always"); setSiteScheduleIds([]); setErr("");
  };

  const addAppRule = async () => {
    const name = normalizeApp(appName);
    if (!name) { setErr("Name the application — e.g. Steam"); return; }
    if (blocking.rules.some((r) => r.kind === "app" && r.target.toLowerCase() === name.toLowerCase())) {
      setErr(`${name} is already on the list.`); return;
    }
    if (appWhen === "scheduled" && !appScheduleIds.length) { setErr("Choose at least one schedule for this application."); return; }
    await persist(upsertRule(blocking, newRule({ kind: "app", target: name, when: appWhen, scheduleIds: appWhen === "scheduled" ? appScheduleIds : [] })));
    setAppName(""); setShowAppRule(false); setAppWhen("always"); setAppScheduleIds([]); setErr("");
  };

  const availableTargets = [...new Map([
    ...observedTargets,
    ...blocking.rules.map(({ kind, target }) => ({ kind, target, seconds: 0 })),
    ...blocking.usageLimits.map(({ kind, target }) => ({ kind, target, seconds: 0 })),
  ].map((target) => [`${target.kind}:${target.target.toLowerCase()}`, target])).values()]
    .filter((target) => target.target.toLowerCase().includes(createSearch.trim().toLowerCase()));
  const hasDesktopTarget = selectedTargets.some((target) => target.kind === "app");
  const totalLimitMinutes = createHours * 60 + createMinutes;

  const createLimit = async () => {
    if (!selectedTargets.length) { setCreateError("Select at least one website or desktop app."); return; }
    if (createMode === "session" && hasDesktopTarget) { setCreateError("Variable session limits currently work for websites only."); return; }
    if (["daily", "session"].includes(createMode) && (!Number.isInteger(totalLimitMinutes) || totalLimitMinutes < 1 || totalLimitMinutes > (createMode === "session" ? 240 : 1440))) {
      setCreateError(createMode === "session" ? "Choose a session allowance from 1 to 240 minutes." : "Choose a daily limit from 1 minute to 24 hours."); return;
    }
    if (createMode === "scheduled" && (!createDays.length || createStart === createEnd)) {
      setCreateError("Choose at least one day and different start/end times."); return;
    }
    const eligible = selectedTargets.filter((chosen) => {
      const target = chosen.kind === "app" ? normalizeApp(chosen.target) : normalizeHost(chosen.target);
      return !blocking.rules.some((rule) => rule.kind === chosen.kind && rule.target.toLowerCase() === target.toLowerCase())
        && !blocking.usageLimits.some((limit) => limit.kind === chosen.kind && limit.target.toLowerCase() === target.toLowerCase());
    });
    if (!eligible.length) { setCreateError("Those targets already have a limit or blocking rule."); return; }
    let next = blocking;
    let schedule = null;
    if (createMode === "scheduled") {
      schedule = newSchedule({ name: createName.trim() || "Usage limit", days: createDays, start: createStart, end: createEnd });
      next = upsertSchedule(next, schedule);
    }
    for (const chosen of eligible) {
      const target = chosen.kind === "app" ? normalizeApp(chosen.target) : normalizeHost(chosen.target);
      const duplicateRule = next.rules.some((rule) => rule.kind === chosen.kind && rule.target.toLowerCase() === target.toLowerCase());
      const duplicateLimit = next.usageLimits.some((limit) => limit.kind === chosen.kind && limit.target.toLowerCase() === target.toLowerCase());
      if (duplicateRule || duplicateLimit) continue;
      if (createMode === "permanent" || createMode === "scheduled") {
        next = upsertRule(next, newRule({
          kind: chosen.kind, target, when: createMode === "scheduled" ? "scheduled" : "always",
          scheduleIds: schedule ? [schedule.id] : [], label: createName.trim() || target,
        }));
      } else {
        next = upsertUsageLimit(next, {
          kind: chosen.kind, target, mode: createMode, dailyLimitMinutes: totalLimitMinutes, name: createName,
        });
      }
    }
    await persist(next);
    setShowLimitCreate(false); setSelectedTargets([]); setCreateName(""); setCreateError("");
  };

  const addSchedule = async () => {
    if (!draft.days.length) { setErr("Pick at least one day for the schedule."); return; }
    if (draft.start === draft.end) { setErr("A schedule needs a start and an end that differ."); return; }
    await persist(upsertSchedule(blocking, draft));
    setDraft(newSchedule({ name: "Work hours" })); setShowSched(false); setErr("");
  };

  const RuleRow = ({ rule }) => {
    const why = verdict.reasons[rule.id];
    const paused = why?.reason === "temp-unblock";
    const blockedNow = Boolean(why) && !paused;
    const usage = rule.kind === "app"
      ? tracked.find((a) => String(a.name).toLowerCase() === rule.target.toLowerCase())
      : null;
    return (
      <div style={{ ...card2(), marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 15 }}>{rule.kind === "app" ? "🪟" : "🌐"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: K.txt, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rule.target}</span>
              {blockedNow && <span style={{ fontSize: 9, fontWeight: 700, color: K.err, background: K.err + "20", padding: "1px 5px", borderRadius: 10, flexShrink: 0 }}>ACTIVE</span>}
              {paused && <span style={{ fontSize: 9, fontWeight: 700, color: K.warn, background: K.warn + "20", padding: "1px 5px", borderRadius: 10, flexShrink: 0 }}>PAUSED</span>}
            </div>
            <div style={{ fontSize: 10.5, color: K.sub, marginTop: 2 }}>
              {usage ? `${usage.used || 0}m used of ${usage.limit}m` : rule.kind === "app" ? "Application" : "Website"}
              {paused ? ` · unpaused in ${Math.max(1, Math.ceil((why.until - now) / 60000))}m` : ""}
            </div>
          </div>
          {blockedNow && blocking.settings.allowTemporaryUnblock && (
            <button type="button" className="b"
              onClick={() => persist(unblockUntil(blocking, rule.id, blocking.settings.tempUnblockMinutes))}
              aria-label={`Pause blocking of ${rule.target} for ${blocking.settings.tempUnblockMinutes} minutes`}
              style={{ ...tag(false, K.warn), padding: "3px 9px", fontSize: 10.5, flexShrink: 0 }}>
              Pause {formatFlowDuration(blocking.settings.tempUnblockMinutes * 60)}
            </button>
          )}
          <Toggle on={rule.enabled} label={rule.target}
            onToggle={() => persist(setRuleEnabled(blocking, rule.id, !rule.enabled))} />
          <button type="button" className="b" onClick={() => persist(removeRule(blocking, rule.id))}
            aria-label={`Remove the rule for ${rule.target}`}
            style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4, flexShrink: 0 }}>
            <Trash2 size={15} color={K.muted} />
          </button>
        </div>
      </div>
    );
  };

  const addButton = (open, setOpen, label) => (
    <button type="button" className="b" onClick={() => { setOpen(!open); setErr(""); }}
      aria-label={open ? "Close" : label} aria-expanded={open}
      style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: open ? K.card : K.acc,
        border: open ? `1px solid ${K.border}` : "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      {open ? <X size={17} color={K.sub} /> : <Plus size={17} color="#fff" />}
    </button>
  );

  return (
    <>
    <div className="npage">
      <h2 style={{ ...pageTitle(), margin: "0 0 16px" }}>North Flow</h2>

      {/* ── Usage: real time the extension recorded, not a manual log. ── */}
      <FlowUsage user={user} onTargets={setObservedTargets} hiddenSites={hiddenUsageSites} onToggleHidden={toggleHiddenUsageSite} />

      <section style={{ ...card(), marginBottom: 14 }} aria-labelledby="flow-limits-heading">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1 }}><div id="flow-limits-heading" style={sectionTitle()}>Usage limits</div>
            <div style={{ fontSize: 11, color: K.sub, marginTop: 3 }}>Websites are enforced by the extension · desktop apps by North Desktop</div>
            {limitSyncNote && <div role="status" style={{ fontSize: 10.5, color: K.acc, marginTop: 4 }}>{limitSyncNote}</div>}</div>
          <button type="button" className="b" onClick={() => { setCreateError(""); setShowLimitCreate(true); }} style={{ padding: "9px 13px", borderRadius: 10, background: K.acc, color: K.onAcc, fontSize: 12, fontWeight: 650, whiteSpace: "nowrap" }}>＋ Create new limit</button>
        </div>
        {blocking.usageLimits.length + blocking.rules.length === 0
          ? <div style={{ ...card2(), color: K.sub, fontSize: 12, textAlign: "center", padding: 18 }}>No limits yet. Create one to choose a site or app and how you want to limit it.</div>
          : [...blocking.usageLimits.map((item) => ({ type: "limit", item })), ...blocking.rules.map((item) => ({ type: "rule", item }))].map(({ type, item }) => {
            const isApp = item.kind === "app";
            const detail = type === "limit" ? (item.mode === "session" ? `${item.dailyLimitMinutes} min per visit` : `${item.dailyLimitMinutes} min per day`) : item.when === "scheduled" ? `Scheduled · ${item.scheduleIds.map((id) => blocking.schedules.find((schedule) => schedule.id === id)?.name).filter(Boolean).join(", ")}` : item.when === "focus" ? "Blocked during focus" : "Blocked permanently";
            return <div key={`${type}:${item.id}`} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${K.border}`, padding: "10px 2px" }}>
              <span aria-hidden="true">{isApp ? "▣" : "◉"}</span><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: K.txt, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label || item.name || item.target}</div>
                <div style={{ color: K.sub, fontSize: 10.5, marginTop: 2 }}>{item.target} · {detail} · {isApp ? "North Desktop" : "Extension"}</div></div>
              <button type="button" className="b" aria-label={`Remove limit for ${item.target}`} onClick={() => persist(type === "limit" ? removeUsageLimit(blocking, item.id) : removeRule(blocking, item.id))} style={{ padding: 6, color: K.muted }}><Trash2 size={14} /></button>
            </div>;
          })}
      </section>

      {false && <div>
        <div style={{ ...sectionTitle(), marginBottom: 4 }}>Website time limits</div>
        <div style={{ fontSize: 11, color: K.sub, marginBottom: 10 }}>
          Daily website caps run in the linked extension; per-visit limits prompt at each browser visit. Daily app caps are enforced by North Desktop.
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
          <select aria-label="Limit target type" value={limitKind} onChange={(e) => { setLimitKind(e.target.value); if (e.target.value === "app") setLimitMode("daily"); }}
            style={{ maxWidth: 120, padding: "7px 6px", borderRadius: 8, color: K.txt, background: K.surf, border: `1px solid ${K.border}`, fontSize: 11 }}>
            <option value="website">Website</option><option value="app">Desktop app</option>
          </select>
          <input aria-label={limitKind === "app" ? "Desktop application for daily limit" : "Website for time limit"} style={{ ...inpSt(), flex: 1, minWidth: 0 }} placeholder={limitKind === "app" ? "e.g. Steam" : "youtube.com"}
            value={limitSite} onChange={(e) => setLimitSite(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addUsageCap(); }} />
          {limitKind === "website" && <select aria-label="Limit type" value={limitMode} onChange={(e) => setLimitMode(e.target.value)}
            style={{ maxWidth: 130, padding: "7px 6px", borderRadius: 8, color: K.txt, background: K.surf, border: `1px solid ${K.border}`, fontSize: 11 }}>
            <option value="daily">Daily limit</option><option value="session">Per visit</option>
          </select>}
          {limitMode === "daily" && <select aria-label="Daily time allowance" value={limitMinutes} onChange={(e) => setLimitMinutes(Number(e.target.value))}
            style={{ maxWidth: 110, padding: "7px 6px", borderRadius: 8, color: K.txt, background: K.surf, border: `1px solid ${K.border}`, fontSize: 11 }}>
            <option value={15}>15m/day</option><option value={30}>30m/day</option><option value={60}>1h/day</option><option value={120}>2h/day</option><option value={240}>4h/day</option>
          </select>}
          <button type="button" className="b" onClick={addUsageCap}
            style={{ padding: "7px 12px", borderRadius: 9, background: K.acc, color: K.onAcc, fontSize: 11, fontWeight: 600 }}>Add</button>
        </div>
        <input aria-label="Optional limit name" style={{ ...inpSt(), marginBottom: 8 }} placeholder="Limit name (optional)"
          value={limitName} onChange={(e) => setLimitName(e.target.value)} />
        {!blocking.usageLimits.length && <div style={{ fontSize: 11, color: K.muted }}>No website time limits set.</div>}
        {blocking.usageLimits.map((limit) => (
          <div key={limit.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${K.border}` }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: K.txt, fontSize: 12 }}>{limit.name ? `${limit.name} · ` : ""}{limit.kind === "app" ? "🖥 " : "🌐 "}{limit.target}</span>
            {limit.mode === "session" ? <span style={{ fontSize: 10.5, color: K.sub }}>Per visit</span> : <select aria-label={`Daily allowance for ${limit.target}`} value={limit.dailyLimitMinutes}
              onChange={(e) => persist(upsertUsageLimit(blocking, { ...limit, dailyLimitMinutes: Number(e.target.value) }))}
              style={{ padding: "5px 6px", borderRadius: 8, color: K.txt, background: K.surf, border: `1px solid ${K.border}`, fontSize: 10.5 }}>
              <option value={15}>15m/day</option><option value={30}>30m/day</option><option value={60}>1h/day</option>
              <option value={120}>2h/day</option><option value={240}>4h/day</option>
            </select>}
            <button type="button" className="b" aria-label={`Remove daily limit for ${limit.target}`}
              onClick={() => persist(removeUsageLimit(blocking, limit.id))} style={{ padding: 4, color: K.muted }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>}

      {false && <details style={{ ...card(), marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: K.txt, fontWeight: 600 }}>Advanced controls · individual rules and schedules</summary>
        <div style={{ paddingTop: 14 }}>
      {/* ── Focus blocking: a real setting the extension and desktop app read
             from the shared model, made visible where its consequences are. ── */}
      <div style={{ ...card(), marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...sectionTitle() }}>Focus blocking</div>
            <div style={{ fontSize: 11.5, color: K.sub, marginTop: 3, lineHeight: 1.5 }}>
              Keep every enabled rule on while a focus session is running.
            </div>
          </div>
          <Toggle on={Boolean(blocking.settings.blockDuringFocus)}
            onToggle={() => persist({
              ...blocking,
              settings: { ...blocking.settings, blockDuringFocus: !blocking.settings.blockDuringFocus },
            })}
            label="focus blocking" />
        </div>
      </div>

      {/* The one honest caveat, as a collapsed disclosure rather than a card:
          this page configures rules; the extension and desktop app enforce
          them. Everything else about enforcement is live status above. */}
      <details style={{ marginBottom: 24 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, color: K.acc, fontWeight: 600 }}>
          How enforcement actually works
        </summary>
        <div style={{ fontSize: 11, color: K.sub, lineHeight: 1.6, marginTop: 8 }}>
          This page stores your rules in your account and shows what they do. It cannot
          block a browser or an OS application itself — sign in to the NORTH extension
          and desktop app with the same account so they can enforce these rules.
          {" "}On mobile, iOS and Android only permit app limits through an OS-granted
          entitlement, which NORTH does not ship yet.
        </div>
      </details>

      {err && (
        <div role="alert" style={{ fontSize: 12, color: K.err, background: K.err + "14", borderRadius: 8, padding: "8px 10px", marginBottom: 14 }}>{err}</div>
      )}

      {/* ── Websites ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: K.txt }}>Websites</div>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            {grouped.websites.length ? `${grouped.websites.length} rule${grouped.websites.length === 1 ? "" : "s"}` : "No domains yet"}
          </div>
        </div>
        {addButton(showSite, setShowSite, "Add a website")}
      </div>

      {showSite && (
        <div style={{ ...card(), marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 7 }}>
            <input autoFocus style={{ ...inpSt(), flex: 1, minWidth: 0 }} placeholder="youtube.com"
              value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWebsite(); }} />
            <button type="button" className="b" onClick={addWebsite}
              style={{ padding: "9px 16px", borderRadius: 10, background: K.acc, color: K.onAcc, fontSize: 12.5, fontWeight: 600 }}>Add</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="siteWhen" style={{ fontSize: 11, color: K.sub }}>Block</label>
            <select id="siteWhen" value={siteWhen} onChange={(e) => setSiteWhen(e.target.value)}
              style={{ ...inpSt(), width: "auto", minWidth: 145, padding: "7px 9px" }}>
              <option value="always">Permanently</option><option value="focus">During focus</option><option value="scheduled">On a schedule</option>
            </select>
            {siteWhen === "scheduled" && (blocking.schedules.length
              ? <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{blocking.schedules.map((sc) => {
                  const selected = siteScheduleIds.includes(sc.id);
                  return <button key={sc.id} type="button" className="b" aria-pressed={selected}
                    onClick={() => setSiteScheduleIds((ids) => selected ? ids.filter((id) => id !== sc.id) : [...ids, sc.id])}
                    style={{ ...tag(selected, K.acc), padding: "5px 8px", fontSize: 10.5 }}>{sc.name}</button>;
                })}</div>
              : <span style={{ fontSize: 11, color: K.warn }}>Create a schedule below first.</span>)}
          </div>
        </div>
      )}

      {grouped.websites.length === 0 && !showSite ? (
        <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 12.5, padding: "26px 14px", marginBottom: 22 }}>
          Block a domain to stop the extension loading it
        </div>
      ) : (
        <div style={{ marginBottom: 22 }}>{grouped.websites.map((r) => <RuleRow key={r.id} rule={r} />)}</div>
      )}

      {/* ── Applications ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: K.txt }}>Applications</div>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            {grouped.apps.length ? `${grouped.apps.length} rule${grouped.apps.length === 1 ? "" : "s"} · ended by the desktop app` : "No applications yet"}
          </div>
        </div>
        {addButton(showAppRule, setShowAppRule, "Add an application")}
      </div>

      {showAppRule && (
        <div style={{ ...card(), marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 7 }}>
            <input autoFocus style={{ ...inpSt(), flex: 1, minWidth: 0 }} placeholder="Application name (e.g. Steam)"
              value={appName} onChange={(e) => setAppName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addAppRule(); }} />
            <button type="button" className="b" onClick={addAppRule}
              style={{ padding: "9px 16px", borderRadius: 10, background: K.acc, color: K.onAcc, fontSize: 12.5, fontWeight: 600 }}>Add</button>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <label htmlFor="appWhen" style={{ fontSize: 11, color: K.sub }}>Block</label>
            <select id="appWhen" value={appWhen} onChange={(e) => setAppWhen(e.target.value)}
              style={{ ...inpSt(), width: "auto", minWidth: 145, padding: "7px 9px" }}>
              <option value="always">Permanently</option><option value="focus">During focus</option><option value="scheduled">On a schedule</option>
            </select>
            {appWhen === "scheduled" && blocking.schedules.map((sc) => {
              const selected = appScheduleIds.includes(sc.id);
              return <button key={sc.id} type="button" className="b" aria-pressed={selected}
                onClick={() => setAppScheduleIds((ids) => selected ? ids.filter((id) => id !== sc.id) : [...ids, sc.id])}
                style={{ ...tag(selected, K.acc), padding: "5px 8px", fontSize: 10.5 }}>{sc.name}</button>;
            })}
            {appWhen === "scheduled" && !blocking.schedules.length && <span style={{ fontSize: 11, color: K.warn }}>Create a schedule below first.</span>}
          </div>
        </div>
      )}

      {grouped.apps.length === 0 && !showAppRule ? (
        <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 12.5, padding: "26px 14px", marginBottom: 22 }}>
          Name an application to keep it closed while a rule is active
        </div>
      ) : (
        <div style={{ marginBottom: 22 }}>{grouped.apps.map((r) => <RuleRow key={r.id} rule={r} />)}</div>
      )}

      {/* ── Schedules ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: K.txt }}>Schedules</div>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            {blocking.schedules.length ? `${blocking.schedules.length} window${blocking.schedules.length === 1 ? "" : "s"}` : "Block only during set hours"}
          </div>
        </div>
        {addButton(showSched, setShowSched, "Add a schedule")}
      </div>

      {showSched && (
        <div style={{ ...card(), marginBottom: 12 }}>
          <input style={{ ...inpSt(), marginBottom: 10 }} placeholder="Schedule name"
            value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <div style={{ fontSize: 11, color: K.sub, marginBottom: 6 }}>Days</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
            {WEEKDAY_LABELS.map((lbl, i) => {
              const on = draft.days.includes(i);
              return (
                <button key={lbl} type="button" className="b"
                  onClick={() => setDraft((d) => ({
                    ...d, days: on ? d.days.filter((x) => x !== i) : [...d.days, i].sort((a, b) => a - b),
                  }))}
                  aria-pressed={on} aria-label={`${lbl}${on ? " on" : " off"}`}
                  style={{ ...tag(on, K.acc), padding: "5px 10px", fontSize: 11 }}>{lbl}</button>
              );
            })}
            <button type="button" className="b" onClick={() => setDraft((d) => ({ ...d, days: [...WORKDAYS] }))}
              style={{ ...tag(false, K.acc), padding: "5px 10px", fontSize: 11 }}>Weekdays</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <input type="time" style={{ ...inpSt(), width: 118, color: K.sub }} value={draft.start}
              aria-label="Schedule start time"
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
            <span style={{ fontSize: 12, color: K.sub }}>to</span>
            <input type="time" style={{ ...inpSt(), width: 118, color: K.sub }} value={draft.end}
              aria-label="Schedule end time"
              onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="b" onClick={() => setShowSched(false)}
              style={{ flex: 1, padding: "8px 0", borderRadius: 8, background: K.surf, color: K.sub, fontSize: 12 }}>Cancel</button>
            <button type="button" className="b" onClick={addSchedule}
              style={{ flex: 2, padding: "8px 0", borderRadius: 8, background: K.acc, color: K.onAcc, fontSize: 12, fontWeight: 600 }}>Add schedule</button>
          </div>
        </div>
      )}

      {blocking.schedules.length === 0 && !showSched ? (
        <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 12.5, padding: "26px 14px", marginBottom: 22 }}>
          Add a window, then point a rule at it
        </div>
      ) : (
        <div style={{ marginBottom: 22 }}>
          {blocking.schedules.map((sc) => {
            const running = verdict.schedules.some((r) => r.id === sc.id);
            return (
              <div key={sc.id} style={{ ...card2(), marginBottom: 8, border: `1px solid ${running ? K.ok + "50" : K.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: K.txt, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sc.name}</span>
                      {running && <span style={{ fontSize: 9, fontWeight: 700, color: K.ok, background: K.ok + "20", padding: "1px 5px", borderRadius: 10, flexShrink: 0 }}>RUNNING</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: K.sub, marginTop: 2 }}>
                      {sc.days.map((d) => WEEKDAY_LABELS[d]).join(" ")} · {sc.start}–{sc.end}
                      {sc.start > sc.end ? " (overnight)" : ""}
                    </div>
                  </div>
                  <Toggle on={sc.enabled} label={sc.name}
                    onToggle={() => persist(upsertSchedule(blocking, { ...sc, enabled: !sc.enabled }))} />
                  <button type="button" className="b" onClick={() => persist(removeSchedule(blocking, sc.id))}
                    aria-label={`Delete the schedule ${sc.name}`}
                    style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4, flexShrink: 0 }}>
                    <Trash2 size={15} color={K.muted} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Usage (manual, and labelled as such) ── */}
      <AppUsage user={user} />
        </div>
      </details>}
      <div style={{ height: 40 }} aria-hidden="true" />

    </div>
    {showLimitCreate && createPortal(
      <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLimitCreate(false); }}
        style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(4,8,18,.72)", backdropFilter: "blur(12px)", padding: "5vh 14px", overflowY: "auto" }}>
        <section role="dialog" aria-modal="true" aria-labelledby="create-flow-limit-title" className="gsheet"
          style={{ width: "min(660px, 100%)", maxHeight: "90vh", overflowY: "auto", margin: "0 auto", padding: 22, borderRadius: 22, background: K.card, border: `1px solid ${K.border}`, boxShadow: "0 24px 80px rgba(0,0,0,.4)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1 }}><h2 id="create-flow-limit-title" style={{ ...pageTitle(), margin: 0 }}>Create new limit</h2><div style={{ color: K.sub, fontSize: 11.5, marginTop: 4 }}>Choose what to limit, then set when or how long.</div></div>
            <button className="b" type="button" aria-label="Close" onClick={() => setShowLimitCreate(false)} style={{ padding: 6, color: K.sub }}><X size={17} /></button>
          </div>
          <label style={{ display: "block", color: K.txt, fontSize: 12, fontWeight: 600, marginBottom: 7 }}>1 · Websites and desktop apps you’ve used</label>
          <input autoFocus style={{ ...inpSt(), marginBottom: 8 }} placeholder="Search usage history" aria-label="Search websites and desktop apps" value={createSearch} onChange={(event) => setCreateSearch(event.target.value)} />
          <div style={{ maxHeight: 205, overflowY: "auto", border: `1px solid ${K.border}`, borderRadius: 12, padding: "4px 10px" }}>
            {availableTargets.length ? availableTargets.map((target) => {
              const selected = selectedTargets.some((item) => item.kind === target.kind && item.target === target.target);
              const disabled = createMode === "session" && target.kind === "app";
              return <label key={`${target.kind}:${target.target}`} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderBottom: `1px solid ${K.border}`, opacity: disabled ? .45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
                <input type="checkbox" checked={selected} disabled={disabled} onChange={() => {
                  setSelectedTargets((items) => selected ? items.filter((item) => !(item.kind === target.kind && item.target === target.target)) : [...items, target]);
                  if (target.kind === "app" && !selected && createMode === "session") setCreateMode("daily");
                }} />
                <span style={{ flex: 1, color: K.txt, fontSize: 12 }}>{target.kind === "app" ? "▣" : "◉"} {target.target}</span>
                <span style={{ color: K.sub, fontSize: 10.5 }}>{target.seconds ? formatFlowDuration(target.seconds) : "Seen"}</span>
              </label>;
            }) : <div style={{ padding: 14, color: K.sub, fontSize: 11.5 }}>No recorded activity yet. Visit a site or use an app, then come back here.</div>}
          </div>
          <div style={{ color: K.sub, fontSize: 10.5, margin: "6px 0 16px" }}>Selected {selectedTargets.length} · website limits run in the extension; app limits run in North Desktop.</div>
          <label style={{ display: "block", color: K.txt, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>2 · Choose a limit type</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 7 }}>
            {[["permanent", "Block permanently", "Keep the target blocked until you remove the limit."], ["scheduled", "Block on a schedule", "Block during selected days and hours."], ["daily", "Set a daily usage limit", "Block once today’s allowance is used."], ["session", "Variable session limit", "Choose an allowance for each visit. Websites only."]].map(([value, title, hint]) => (
              <button key={value} type="button" role="radio" aria-checked={createMode === value} onClick={() => { setCreateMode(value); if (value === "session" && hasDesktopTarget) setSelectedTargets((items) => items.filter((item) => item.kind === "website")); }}
                style={{ textAlign: "left", border: `1px solid ${createMode === value ? K.acc : K.border}`, borderRadius: 12, padding: 10, background: createMode === value ? K.accDim : K.surf, color: K.txt, cursor: "pointer" }}>
                <div style={{ fontSize: 12, fontWeight: 650 }}>{createMode === value ? "◉ " : "○ "}{title}</div><div style={{ color: K.sub, fontSize: 10.5, lineHeight: 1.4, marginTop: 4 }}>{hint}</div>
              </button>))}
          </div>
          {createMode === "scheduled" && <div style={{ marginTop: 15 }}>
            <div style={{ fontSize: 11.5, color: K.txt, fontWeight: 600, marginBottom: 7 }}>3 · Schedule</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>{WEEKDAY_LABELS.map((day, index) => <button key={day} type="button" className="b" aria-pressed={createDays.includes(index)} onClick={() => setCreateDays((days) => days.includes(index) ? days.filter((item) => item !== index) : [...days, index].sort((a, b) => a - b))} style={{ ...tag(createDays.includes(index), K.acc), padding: "6px 9px", fontSize: 10.5 }}>{day}</button>)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}><input type="time" aria-label="Schedule start time" value={createStart} onChange={(event) => setCreateStart(event.target.value)} style={{ ...inpSt(), width: 135 }} /><span style={{ color: K.sub }}>to</span><input type="time" aria-label="Schedule end time" value={createEnd} onChange={(event) => setCreateEnd(event.target.value)} style={{ ...inpSt(), width: 135 }} /></div>
          </div>}
          {["daily", "session"].includes(createMode) && <div style={{ marginTop: 15 }}>
            <label style={{ display: "block", color: K.txt, fontSize: 11.5, fontWeight: 600, marginBottom: 7 }}>3 · Allowance {createMode === "daily" ? "per day" : "per visit"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="number" min="0" max="24" aria-label="Hours" value={createHours} onChange={(event) => setCreateHours(Math.max(0, Number(event.target.value)))} style={{ ...inpSt(), width: 105 }} /><span style={{ color: K.sub, fontSize: 11 }}>hours</span><input type="number" min="0" max="59" aria-label="Minutes" value={createMinutes} onChange={(event) => setCreateMinutes(Math.min(59, Math.max(0, Number(event.target.value))))} style={{ ...inpSt(), width: 105 }} /><span style={{ color: K.sub, fontSize: 11 }}>minutes</span></div>
          </div>}
          <label style={{ display: "block", color: K.txt, fontSize: 11.5, fontWeight: 600, margin: "16px 0 6px" }}>4 · Name this limit <span style={{ color: K.muted, fontWeight: 400 }}>(optional)</span></label>
          <input style={inpSt()} placeholder="e.g. Work focus" value={createName} onChange={(event) => setCreateName(event.target.value)} />
          {createError && <div role="alert" style={{ color: K.err, fontSize: 11.5, marginTop: 9 }}>{createError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}><button type="button" className="b" onClick={() => setShowLimitCreate(false)} style={{ padding: "9px 14px", color: K.sub }}>Cancel</button><button type="button" className="b" onClick={createLimit} style={{ padding: "9px 16px", borderRadius: 9, background: K.acc, color: K.onAcc, fontSize: 12, fontWeight: 650 }}>Create limit</button></div>
        </section>
      </div>, document.body)}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SOCIAL / LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════
const MEDALS = ["🥇", "🥈", "🥉"];

function Social({ user }) {
  const [tab,     setTab]     = useState("board");
  const [board,   setBoard]   = useState([]);
  const [friends, setFriends] = useState(user.friends || []);
  // The real social graph: my outgoing pending requests, incoming requests
  // (readable under migration 003's friends_incoming_read policy), and the
  // friend feed aggregate. Gracefully degrade when 003 isn't applied yet.
  const [incoming, setIncoming] = useState([]);
  const [pendingOut, setPendingOut] = useState([]);
  const [feed, setFeed] = useState([]);
  const [fi,      setFi]      = useState("");
  const [ferr,    setFerr]    = useState("");
  const [loading, setLoading] = useState(true);
  // Why the live half of this screen is unavailable, stated plainly instead of
  // spinning forever. "" means everything answered. `partial` distinguishes
  // "the server said no" from "this build has no account service configured".
  const [notice,  setNotice]  = useState(null);
  // First paint only: a later refresh (accept a request, add a friend) must
  // never blank the screen back to a spinner.
  const painted = useRef(false);

  /** Read the leaderboard rows this device holds. Local only — never awaits a
   *  network round trip — so the page can always paint something real. */
  const localBoard = async () => {
    try {
      const keys = await S.list("lb:", true, false);
      const entries = (await Promise.all(
        keys.map((k) => S.get(k, true).then((d) => (d ? { un: k.slice(3), ...d } : null)))
      )).filter(Boolean);
      entries.sort((a, b) => (b.fm || 0) - (a.fm || 0));
      return entries;
    } catch { return []; }
  };

  const loadSocial = async () => {
    if (!painted.current) setLoading(true);
    setNotice(null);

    // ── Phase 1: what this device already knows (no network) ──
    // The page is usable from here on: even if every request below hangs, the
    // spinner is already gone and the board shows the last known rows.
    const cached = await localBoard();
    setBoard(cached);
    painted.current = true;
    setLoading(false);

    if (!supabaseConfigured || !supabase) {
      setNotice({ kind: "info", msg: "Accounts aren't configured on this build, so the live leaderboard and friend list are unavailable — this is what the device has recorded." });
      return;
    }

    // ── Phase 2: the live refresh + social graph, strictly time-boxed ──
    // Every one of these is a request that can hang on a flaky network. Bounded
    // so a page can never sit on "Loading…"; the failure is reported instead.
    try {
      const [, mine, inc, fd] = await withTimeout(Promise.all([
        SYNC.leaderboard(),
        SYNC.pull().catch(() => {}).then(() => S.get(`u:${user.un}`)).then((u) => u?.friends) || user.friends || [],
        // Incoming pending requests: rows pointing at my username.
        supabase.from("friends").select("user_id, friend_un, created_at")
          .eq("friend_un", user.un).eq("status", "pending"),
        SYNC.friendFeed(),
      ]), 12000);
      if (Array.isArray(mine)) setFriends(mine);
      setIncoming((inc?.data || []).map((r) => ({ un: r.user_id, at: r.created_at })));
      setFeed(fd || []);
      const live = await localBoard();
      if (live.length) setBoard(live);
    } catch (e) {
      setNotice({
        kind: "err",
        msg: /migration 003|does not exist|schema cache/i.test(e?.message || "")
          ? "Social needs migration 003 applied (see SETUP.md). Showing this device's copy."
          : e?.message === TIMEOUT
            ? "The server didn't answer in time — showing this device's copy. Check your connection and try again."
            : `Couldn't reach the server: ${e?.message || String(e)}`,
      });
    }
  };

  // The staged loader intentionally reruns only when the account changes;
  // button actions invoke it directly after their own state transition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSocial(); }, [user.un]);

  const myRank = board.findIndex((e) => e.un === user.un) + 1;
  const myData = board.find((e) => e.un === user.un);
  const feedFor = (un) => feed.find((f) => f.un === un);
  const fBoard = board.filter((e) => friends.includes(e.un));
  const others = board.filter((e) => e.un !== user.un);

  const act = async (un, action) => {
    setFerr("");
    try {
      await SYNC.friendAction(un, action);
      if (action === "accept") {
        setIncoming((l) => l.filter((r) => r.un !== un));
        setFriends((l) => (l.includes(un) ? l : [...l, un]));
      } else if (action === "reject") setIncoming((l) => l.filter((r) => r.un !== un));
      else if (action === "cancel") setPendingOut((l) => l.filter((u) => u !== un));
      else if (action === "remove") setFriends((l) => l.filter((f) => f !== un));
      loadSocial();
    } catch (e) {
      setFerr(/relation .* does not exist|schema cache/i.test(e?.message || "")
        ? "Social requests need migration 003 applied (see SETUP.md)."
        : e?.message || String(e));
    }
  };

  const doAdd = async () => {
    const un = fi.toLowerCase().trim();
    if (!un) return;
    if (un === user.un)        return setFerr("Can't add yourself.");
    if (friends.includes(un)) return setFerr("Already friends.");
    // Send a real request through the RPC; the server validates existence.
    try {
      await SYNC.friendAction(un, "request");
      setPendingOut((l) => [...l, un]); setFi(""); setFerr("");
      loadSocial();
    } catch (e) {
      setFerr(/schema cache/i.test(e?.message || "")
        ? "Social requests need migration 003 applied (see SETUP.md)."
        : e?.message || String(e));
    }
  };

  const Row = ({ e, rank, rm }) => (
    <div style={{
      ...card2(), marginBottom: 7, display: "flex", alignItems: "center", gap: 10,
      background: e.un === user.un ? K.accDim : K.card2,
      border: `1px solid ${e.un === user.un ? K.acc + "50" : K.border}`,
    }}>
      <div style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>
        {rank <= 3 ? MEDALS[rank - 1] : <span style={{ fontSize: 11, color: K.sub }}>{rank}</span>}
      </div>
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: K.acc,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: K.onAcc, fontSize: 12, fontWeight: 700,
      }}>{(e.name || e.un)[0].toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: K.txt, fontWeight: 500 }}>
          {e.name || e.un}
          {e.un === user.un && <span style={{ fontSize: 10, color: K.acc, marginLeft: 6 }}>you</span>}
        </div>
        <div style={{ fontSize: 10, color: K.sub, marginTop: 1 }}>
          {/* Only show a stat this entry actually has. The public leaderboard
              aggregate carries focus minutes and active days; completed tasks
              and streaks are private, so they are omitted rather than shown
              as a misleading zero. */}
          {Number.isFinite(e.tc) && Number.isFinite(e.streak)
            ? `${e.tc} tasks · ${e.streak}d streak`
            : Number.isFinite(e.activeDays) && e.activeDays > 0
              ? `${e.activeDays} active day${e.activeDays === 1 ? "" : "s"}`
              : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: K.acc, fontVariantNumeric: "tabular-nums" }}>{e.fm || 0}m</div>
        <div style={{ fontSize: 9, color: K.muted }}>focused</div>
      </div>
      {rm && <button type="button" className="b" onClick={() => act(e.un, "remove")}
        aria-label={`Remove ${e.name || e.un} from friends`}
        style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}><X size={15} color={K.muted} /></button>}
    </div>
  );

  return (
    <div className="npage">
      <h2 style={{ ...pageTitle(), margin: "0 0 16px" }}>Social</h2>

      {/* My rank card — only shown when there are actually other users */}
      {others.length > 0 && myData && (
        <div style={{
          ...card(), marginBottom: 20,
          background: K.accDim,
          border: `1px solid ${K.acc}30`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 10, color: K.sub, marginBottom: 4, letterSpacing: 1 }}>YOUR RANK</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: K.txt }}>{myRank > 0 ? `#${myRank}` : "—"}</div>
            <div style={{ fontSize: 10, color: K.sub }}>of {board.length} users</div>
          </div>
          {[
            { lbl: "FOCUS",  val: `${myData.fm || 0}m`,         col: K.acc  },
            { lbl: "TASKS",  val: myData.tc || 0,                col: K.ok   },
            { lbl: "STREAK", val: `${myData.streak || 0}d`,      col: K.warn },
          ].map((s) => (
            <div key={s.lbl} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: K.sub, marginBottom: 2 }}>{s.lbl}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: K.txt, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Social sections"
        style={{ display: "flex", background: K.surf, borderRadius: 10, padding: 3, marginBottom: 16, border: `1px solid ${K.border}` }}>
        {/* The metric is named on the tab: rankings come from the server's
            aggregate of recorded focus minutes (`daily_focus`, written by the
            database from sessions — a client cannot inflate it). */}
        {[["board", "Leaderboard · focus time"], ["friends", "Friends"]].map(([id, lbl]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="b"
            onClick={() => setTab(id)}
            style={{
              flex: 1, textAlign: "center", padding: 7, borderRadius: 8,
              background: tab === id ? K.accDim : "transparent",
              color: tab === id ? K.acc : K.sub, fontSize: 12, fontWeight: 600, transition: "all .2s",
            }}>{lbl}</button>
        ))}
      </div>

      {notice && (
        <div role="status" style={{
          display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 14,
          padding: "9px 12px", borderRadius: 10,
          background: notice.kind === "err" ? K.err + "14" : K.accDim,
          border: `1px solid ${notice.kind === "err" ? K.err + "40" : K.acc + "30"}`,
          color: K.txt, fontSize: 12.5, lineHeight: 1.5,
        }}>
          <span aria-hidden="true" style={{ fontSize: 13 }}>{notice.kind === "err" ? "⚠" : "ℹ"}</span>
          <span style={{ flex: 1 }}>{notice.msg}</span>
          <button type="button" className="b" onClick={() => loadSocial()}
            style={{ color: K.acc, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ ...card(), textAlign: "center", color: K.sub, padding: 40, fontSize: 13 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="north-spin" aria-hidden="true" /> Loading your leaderboard…
          </span>
        </div>
      ) : tab === "board" ? (
        others.length === 0 ? (
          <div style={{ ...card(), textAlign: "center", padding: "34px 18px" }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, background: K.accDim, margin: "0 auto 12px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><Users size={24} color={K.acc} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: K.txt }}>
              {notice ? "No other players here yet" : "Your leaderboard is fresh"}
            </div>
            <div style={{ fontSize: 12, color: K.sub, marginTop: 6, lineHeight: 1.6, maxWidth: 330, marginLeft: "auto", marginRight: "auto" }}>
              {notice
                ? "Rankings are live and server-computed — nobody else has recorded focus time that this device can see yet. Nothing here is invented; it fills in as people join NORTH on any client."
                : "You're the first one here. Rankings are live and server-computed — they fill up as more people join NORTH on any client."}
            </div>
          </div>
        ) : board.slice(0, 25).map((e, i) => <Row key={e.un} e={e} rank={i + 1} />)
      ) : (
        <div>
          <div style={{ display: "flex", gap: 7, marginBottom: 8 }}>
            <input style={{ ...inpSt(), flex: 1 }} placeholder="Add friend by username…"
              value={fi} onChange={(e) => setFi(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doAdd()} />
            <button type="button" className="b" onClick={doAdd}
              style={{ padding: "10px 18px", borderRadius: 10, background: K.acc, color: K.onAcc, fontSize: 13, fontWeight: 600 }}>
              Add
            </button>
          </div>
          {ferr && <div style={{ color: K.err, fontSize: 12, marginBottom: 10 }}>{ferr}</div>}

          {/* Incoming requests — accept or reject. */}
          {incoming.length > 0 && (
            <div style={{ ...card(), padding: "4px 14px", marginBottom: 10 }}>
              {incoming.map((r, i) => (
                <div key={r.un} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < incoming.length - 1 ? `1px solid ${K.border}` : "none" }}>
                  <div style={{ flex: 1, fontSize: 13, color: K.txt }}>
                    <strong>{r.un}</strong> wants to be your friend
                  </div>
                  <button type="button" className="b" onClick={() => act(r.un, "accept")}
                    style={{ fontSize: 12, fontWeight: 600, color: K.onAcc, background: K.acc, padding: "7px 13px", borderRadius: 9 }}>Accept</button>
                  <button type="button" className="b" onClick={() => act(r.un, "reject")}
                    style={{ fontSize: 12, color: K.sub, background: K.surf, padding: "7px 13px", borderRadius: 9 }}>Reject</button>
                </div>
              ))}
            </div>
          )}

          {/* Outgoing pending — cancellable. */}
          {pendingOut.length > 0 && (
            <div style={{ ...card2(), padding: "10px 14px", marginBottom: 10, fontSize: 12, color: K.sub }}>
              Pending: {pendingOut.join(", ")} —{" "}
              {pendingOut.map((un) => (
                <button key={un} type="button" className="b" onClick={() => act(un, "cancel")}
                  style={{ color: K.acc, fontSize: 11.5, marginLeft: 6 }}>cancel</button>
              ))}
            </div>
          )}

          {friends.length === 0 ? (
            <div style={{ ...card(), textAlign: "center", padding: "30px 16px" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>👋</div>
              <div style={{ fontSize: 13, color: K.txt, fontWeight: 600 }}>No friends yet</div>
              <div style={{ fontSize: 11.5, color: K.sub, marginTop: 5, lineHeight: 1.6, maxWidth: 300, marginLeft: "auto", marginRight: "auto" }}>
                Send a friend request by username. When they accept, their focus stats join your Friends tab.
              </div>
            </div>
          ) : fBoard.length === 0 ? (
            <div style={{ textAlign: "center", color: K.muted, fontSize: 12, padding: 20 }}>Waiting on friends' first sessions…</div>
          ) : (
            fBoard.map((e) => {
              const rank = board.findIndex((b) => b.un === e.un) + 1;
              const f = feedFor(e.un);
              return <Row key={e.un} e={{ ...e, ...(f ? { fm: f.fm, activeDays: f.activeDays, last: f.last } : {}) }} rank={rank} rm />;
            })
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// INTEGRATIONS — Google Calendar connect / refresh / disconnect
// ══════════════════════════════════════════════════════════════════════════
/**
 * The Settings surface for external connections. States are honest: Connect
 * (→ Edge Function → Google consent), Connected (email + last sync + Refresh
 * + Disconnect), and a plain error line when something is off server-side.
 * Events themselves are rendered by the Calendar / Focus / Home screens from
 * the shared `gcal:<un>` cache; this card only manages the connection.
 */
/**
 * The connection state of an integration, as a word. "Connected" is the only
 * thing the server can prove; everything else is stated as what it actually is
 * (not configured, not connected, error) rather than left for the user to
 * infer from the colour of a button.
 */
const StatusChip = ({ state, children }) => {
  const col = state === "on" ? K.ok : state === "err" ? K.err : K.sub;
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, flexShrink: 0, whiteSpace: "nowrap",
      color: col, background: col + "1A", border: `1px solid ${col}33`,
      padding: "2px 8px", borderRadius: 999,
    }}>{children}</span>
  );
};

function IntegrationsCard({ user, gcal, onGcal }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const why = gcalWhy;

  const refresh = async () => {
    setBusy("sync"); setErr("");
    const res = await syncGoogleCalendar(S, user.un);
    if (res.error) setErr(why(res.error));
    else if (res.connected === false) setErr("Google Calendar isn't connected.");
    if (!res.error) onGcal((g) => ({ ...g, ...(res.events ? { events: res.events, fetchedAt: res.fetchedAt } : {}), connected: res.connected }));
    setBusy("");
  };

  const disconnect = async () => {
    setBusy("disc"); setErr("");
    try {
      await disconnectGoogleCalendar(S, user.un);
      onGcal({ connected: false, email: null, events: [], fetchedAt: 0 });
    } catch (error) { setErr(why(String(error?.message ?? error))); }
    finally { setBusy(""); }
  };

  const syncLabel = gcal.fetchedAt
    ? `Last synced ${new Date(gcal.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${gcal.events.length} event${gcal.events.length === 1 ? "" : "s"}`
    : "Never synced";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div aria-hidden="true" style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: gcal.connected ? K.ok + "18" : K.surf, border: `1px solid ${GK.edge}`,
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" />
            <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.2v5.7C7.8 41 15.3 46 24 46z" />
            <path fill="#FBBC05" d="M11.6 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.2C2.7 17.1 1.9 20.4 1.9 24s.8 6.9 2.3 9.9l7.4-5.7z" />
            <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.2 30 2 24 2 15.3 2 7.8 7 4.2 14.1l7.4 5.7c1.7-5.2 6.6-9.1 12.4-9.1z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: K.txt }}>Google Calendar</span>
            <StatusChip state={err ? "err" : gcal.connected ? "on" : "off"}>
              {err ? "ERROR" : gcal.connected ? "CONNECTED" : "NOT CONNECTED"}
            </StatusChip>
          </div>
          <div style={{ fontSize: 11.5, color: K.muted, marginTop: 3 }}>
            {gcal.connected ? `${gcal.email || "Connected"} · ${syncLabel}` : "See your events next to your tasks."}
          </div>
        </div>
        {gcal.connected ? (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" className="b" onClick={refresh} disabled={Boolean(busy)}
              aria-label="Sync Google Calendar now"
              style={{ fontSize: 12, fontWeight: 600, color: K.acc, padding: "7px 11px", borderRadius: 9, background: K.accDim }}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="b" onClick={disconnect} disabled={Boolean(busy)}
              aria-label="Disconnect Google Calendar"
              style={{ fontSize: 12, color: K.err, padding: "7px 11px", borderRadius: 9, background: K.err + "14" }}>
              Disconnect
            </button>
          </div>
        ) : (
          <button type="button" className="b gacc" onClick={() => {
            setBusy("conn"); setErr("");
            connectGoogleCalendar().catch((e) => {
              setErr(why(String(e?.message ?? e)));
              setBusy("");
            });
          }} disabled={Boolean(busy)}
            style={{ fontSize: 12.5, fontWeight: 600, color: K.onAcc, padding: "9px 14px", borderRadius: 10, background: K.acc, flexShrink: 0 }}>
            {busy === "conn" ? "Opening Google…" : "Connect"}
          </button>
        )}
      </div>
      {err && <div role="alert" style={{ fontSize: 11.5, color: K.err, marginTop: 9 }}>{err}</div>}
      {gcal.connected && (
        <p style={{ fontSize: 10.5, color: K.muted, margin: "10px 0 0", lineHeight: 1.55 }}>
          North reads your events (read-only). North tasks and Google events stay separate — one never overwrites the other.
        </p>
      )}
    </div>
  );
}

/**
 * The Focus-screen music strip: current track + minimal transport. Renders
 * only when connected; polls sparingly (15 s); every control failure lands
 * as honest text (offline / premium required / nothing playing).
 */
const SPOTIFY_EMBED_KEY = "northSpotifyEmbedUrl";
const DEFAULT_SPOTIFY_PLAYLIST = "https://open.spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6";

function spotifyEmbed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "open.spotify.com") return null;
    const [, type, id] = parsed.pathname.split("/");
    if (!/^(playlist|album|track|artist|show|episode)$/.test(type || "") || !/^[A-Za-z0-9]+$/.test(id || "")) return null;
    return { src: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`, height: ["playlist", "album", "artist", "show"].includes(type) ? 352 : 152 };
  } catch { return null; }
}

/** Floating player using Spotify's official interactive Embed. */
function SpotifyFloatingPlayer() {
  const [url, setUrl] = useState(() => { try { return localStorage.getItem(SPOTIFY_EMBED_KEY) || DEFAULT_SPOTIFY_PLAYLIST; } catch { return DEFAULT_SPOTIFY_PLAYLIST; } });
  const [minimized, setMinimized] = useState(() => {
    try { return window.matchMedia("(max-width: 600px)").matches; }
    catch { return true; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(SPOTIFY_EMBED_KEY) || DEFAULT_SPOTIFY_PLAYLIST; } catch { return DEFAULT_SPOTIFY_PLAYLIST; } });
  const [error, setError] = useState("");
  useEffect(() => {
    const update = (event) => setUrl(event.detail || "");
    window.addEventListener("north:spotify-embed", update);
    return () => window.removeEventListener("north:spotify-embed", update);
  }, []);
  const embed = spotifyEmbed(url);
  return <section className={`spotify-float-window${minimized ? " is-minimized" : ""}`} aria-label="Floating Spotify player">
    <div className="spotify-float-head">
      <span>Spotify</span>
      <div>
        <button type="button" className="b" onClick={() => setMinimized((value) => !value)} aria-label={minimized ? "Expand Spotify player" : "Minimize Spotify player"}>{minimized ? "+" : "−"}</button>
        <button type="button" className="b" onClick={() => { setEditing((value) => !value); setMinimized(false); }} aria-label="Set Spotify playlist" title="Set Spotify playlist"><Settings size={15} /></button>
      </div>
    </div>
    {!minimized && editing && <div className="spotify-float-edit">
      <input value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} placeholder="Paste a Spotify playlist or track link" aria-label="Spotify playlist or track link" />
      <button type="button" className="b" onClick={() => {
        if (draft && !spotifyEmbed(draft)) { setError("Use a Spotify share link from open.spotify.com."); return; }
        const next = draft.trim() || DEFAULT_SPOTIFY_PLAYLIST;
        try { next ? localStorage.setItem(SPOTIFY_EMBED_KEY, next) : localStorage.removeItem(SPOTIFY_EMBED_KEY); } catch {}
        setUrl(next);
        window.dispatchEvent(new CustomEvent("north:spotify-embed", { detail: next }));
        setEditing(false);
        setError("");
      }}>Save</button>
      {error && <small role="alert">{error}</small>}
    </div>}
    {!minimized && !editing && embed && <iframe title="Spotify player" src={embed.src} width="100%" height={embed.height} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />}
    {!minimized && !editing && !embed && <div className="spotify-float-empty">The Spotify player is unavailable. Check your connection and try again.</div>}
  </section>;
}

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS / ACCOUNT
// ══════════════════════════════════════════════════════════════════════════
// One place for the controls that previously lived in three spots: the header
// theme switch, the header right-click dropdown, and the Focus screen's timer
// settings. The header controls stay (one tap away on every screen); this is
// the complete view. Nothing new is invented: every control here already
// existed, and every persistence path is the one the app already uses
// (`S.*` → sync → profiles / profiles.settings). Account vs device follows
// the line SYNC.md draws: name + pomodoro settings are account data; theme,
// right-click preference and reminders are device-local by design.
function FocusPreferences({ user, onUpdate }) {
  // Timer durations — the ONE place they are editable. Same pomodoro profile
  // (`u:<un>.pm`) the Focus timer reads, same clamp/step constants, so the
  // dial changes the moment the next phase begins. No sound/notify controls:
  // end-of-session behavior is not a customization surface.
  const [pm, setPm] = useState({ w: 25, sb: 5, lb: 15, ...(user.pm || {}) });
  const bumpDur = (k, delta) => {
    const v = Math.min(F_MAX[k], Math.max(F_MIN[k], pm[k] + delta));
    if (v === pm[k]) return;
    const next = { ...pm, [k]: v };
    setPm(next);
    onUpdate(next);
    S.get(`u:${user.un}`).then((u) => S.set(`u:${user.un}`, { ...(u || {}), pm: { ...(u?.pm || {}), w: next.w, sb: next.sb, lb: next.lb } }));
  };

  return (
      <div style={{ ...card(), padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span>Session lengths</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { k: "w",  lbl: "Focus duration" },
            { k: "sb", lbl: "Short break duration" },
            { k: "lb", lbl: "Long break duration" },
          ].map(({ k, lbl }) => (
            <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13.5, color: K.txt }}>{lbl}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" className="b" onClick={() => bumpDur(k, -F_STEP[k])}
                  aria-label={`Decrease ${lbl.toLowerCase()} by ${F_STEP[k]} minutes`}
                  style={{ width: 28, height: 28, borderRadius: 9, background: K.surf, border: `1px solid ${K.border}`, color: K.sub, fontSize: 17, lineHeight: 1 }}>−</button>
                <span aria-live="polite" style={{ fontSize: 16, fontWeight: 700, color: K.txt, minWidth: 44, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{pm[k]} min</span>
                <button type="button" className="b" onClick={() => bumpDur(k, F_STEP[k])}
                  aria-label={`Increase ${lbl.toLowerCase()} by ${F_STEP[k]} minutes`}
                  style={{ width: 28, height: 28, borderRadius: 9, background: K.acc, color: K.onAcc, fontSize: 17, lineHeight: 1 }}>+</button>
              </div>
            </div>
          ))}
        </div>
      </div>

  );
}

function SettingsScreen({ user, envId, envPhoto, onEnv, onPhoto, onPhotoAdj, onRemovePhoto, onLogout, onName }) {
  const [name, setName] = useState(user.name || "");
  const [saved, setSaved] = useState(false);
  const [photoSettingsOpen, setPhotoSettingsOpen] = useState(false);
  const photoInput = useRef(null);


  // Display name edits write the profile record through S — the same path as
  // every other screen — and land in `profiles.name` on the next push.
  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) return;
    try {
      const u = (await S.get(`u:${user.un}`)) || {};
      await S.set(`u:${user.un}`, { ...u, name: trimmed });
      // Keep the in-memory account in sync immediately; otherwise other
      // screens continue rendering the old name until the next hydration.
      onName(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* storage unavailable — nothing to save */ }
  };

  const notifGranted = typeof Notification !== "undefined" && Notification.permission === "granted";
  const notifDenied = typeof Notification !== "undefined" && Notification.permission === "denied";
  const secLbl = { fontSize: 10, color: K.sub, letterSpacing: 0.6, marginBottom: 12 };
  // Permission must be requested from a user gesture — this button.
  const askNotif = () => {
    try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch {}
  };

  return (
    <div className="npage">
      <h2 style={{ ...pageTitle(), margin: "0 0 20px" }}>Settings</h2>

      {/* Account */}
      <div style={{ ...card(), padding: "14px 16px", marginBottom: 12 }}>
        <div style={secLbl}>ACCOUNT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: 11, borderRadius: 14, background: GK.tintSubtle, border: `1px solid ${GK.edge}`, boxShadow: `inset 0 1px 0 ${GK.hi}` }}>
          <div style={{
            width: 46, height: 46, borderRadius: 14, background: `linear-gradient(145deg, ${K.acc}, ${K.acc}BB)`, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: K.onAcc, fontSize: 18, fontWeight: 800,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,.42), 0 5px 14px ${K.acc}35`,
          }}>{initial(user)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayName(user)}
            </div>
            <div style={{ fontSize: 12, color: K.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email || `@${user.un}`}{user.authLinked ? "" : " · device only"}
            </div>
          </div>
          <span style={{ flexShrink: 0, borderRadius: 999, padding: "4px 8px", fontSize: 9, fontWeight: 750, letterSpacing: .5, color: user.authLinked ? K.ok : K.sub, background: user.authLinked ? K.ok + "18" : GK.tintSubtle, border: `1px solid ${user.authLinked ? K.ok + "40" : GK.edge}` }}>
            {user.authLinked ? "SYNCED" : "LOCAL"}
          </span>
        </div>
        <label htmlFor="settings-name" style={{ fontSize: 12, color: K.sub, display: "block", marginBottom: 6 }}>
          Display name <span style={{ color: K.muted }}>· synced to your account</span>
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input id="settings-name" style={{ ...inpSt(), flex: 1 }} value={name} maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()} onBlur={saveName}
            placeholder="Your name" />
          {saved && (
            <span aria-live="polite" style={{ display: "flex", alignItems: "center", color: K.ok, fontSize: 12, fontWeight: 600, gap: 4 }}>
              <Check size={14} color={K.ok} /> Saved
            </span>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span style={{ fontSize: 12, color: K.sub }}>
            {user.authLinked ? "Signed in" : "Device only — no account linked"}
          </span>
          <button type="button" className="b" onClick={onLogout}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
              color: K.err, padding: "7px 12px", borderRadius: 9, background: K.err + "14",
            }}>
            <LogOut size={14} color={K.err} /> Sign out
          </button>
        </div>
      </div>

      {/* Background — the environment IS the theme. The whole app renders
          through the selected atmosphere; glass picks up its colors for real
          (the lenses are live backdrop-filters over the actual scene). */}
      <div style={{ ...card(), padding: "14px 16px", marginBottom: 12 }}>
        <div style={secLbl}>BACKGROUND</div>
        <div role="radiogroup" aria-label="Background environment" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
          {ENV_IDS.map((id) => {
            const e = ENVS[id];
            const sel = envId === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={sel} className="b ghov"
                onClick={() => onEnv(id)}
                style={{
                  padding: "7px 7px 8px", borderRadius: 13, textAlign: "left",
                  background: sel ? GK.tintCard : GK.tintSubtle,
                  border: `1px solid ${sel ? K.acc : GK.edge}`,
                  boxShadow: sel ? `0 0 0 1px ${K.acc}, inset 0 1px 0 ${GK.hi}` : `inset 0 1px 0 ${GK.hi}`,
                  transition: "border-color .15s ease, box-shadow .15s ease",
                }}>
                {/* The wallpaper itself sells the environment — no miniature
                    reconstruction of it, and no description paragraph under
                    it. lazy + async so the five images are not all fetched
                    up front on a page most visits never scroll to. */}
                <span aria-hidden="true" style={{
                  display: "block", height: 54, borderRadius: 9, position: "relative", overflow: "hidden",
                  border: `1px solid ${GK.edge}`, background: e.base,
                }}>
                  <img src={e.img} alt="" loading="lazy" decoding="async"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </span>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
                  <span style={{ fontSize: 11.5, fontWeight: sel ? 700 : 500, color: sel ? K.acc : K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.lbl}</span>
                  {sel && <Check size={13} color={K.acc} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
          {/* Custom photo — becomes the full-viewport environment. */}
          <div style={{ position: "relative", minWidth: 0 }}>
          <button type="button" role="radio" aria-checked={envId === "custom"} className="b ghov"
            onClick={() => {
              if (envPhoto?.data) {
                onEnv("custom"); // a saved photo exists → apply it directly, no dialog
              } else {
                photoInput.current?.click(); // none yet → pick one
              }
            }}
            disabled={!onPhoto}
            style={{
              width: "100%", padding: "7px 7px 8px", borderRadius: 13, textAlign: "left",
              background: envId === "custom" ? GK.tintCard : GK.tintSubtle,
              border: `1px dashed ${envId === "custom" ? K.acc : GK.edge}`,
              boxShadow: envId === "custom" ? `0 0 0 1px ${K.acc}, inset 0 1px 0 ${GK.hi}` : `inset 0 1px 0 ${GK.hi}`,
              transition: "border-color .15s ease, box-shadow .15s ease",
            }}>
            <span aria-hidden="true" style={{
              display: "flex", height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center",
              border: `1px solid ${GK.edge}`,
              background: envPhoto && envPhoto.data ? `url("${envPhoto.data}") center/cover` : GK.tintSubtle,
            }}>
              {envPhoto && envPhoto.data
                ? <Check size={15} color={K.acc} />
                : <Plus size={16} color={K.sub} />}
            </span>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
              <span style={{ fontSize: 11.5, fontWeight: envId === "custom" ? 700 : 500, color: envId === "custom" ? K.acc : K.txt }}>
                {envPhoto && envPhoto.data ? "Custom Photo" : "Add Custom Photo"}
              </span>
            </span>
          </button>
          {envPhoto?.data && <button type="button" className="b" aria-label="Remove custom photo" title="Remove custom photo" onClick={onRemovePhoto}
            style={{ position: "absolute", top: 11, right: 43, width: 27, height: 27, borderRadius: 8, display: "grid", placeItems: "center", color: K.txt, background: "rgba(255,255,255,.24)", border: `1px solid ${GK.edge}`, backdropFilter: "blur(10px)" }}><X size={14} aria-hidden="true" /></button>}
          <button type="button" className="b" aria-label={photoSettingsOpen ? "Close custom image settings" : "Custom image settings"} title="Custom image settings"
            aria-expanded={photoSettingsOpen} disabled={!envPhoto?.data}
            onClick={() => { onEnv("custom"); setPhotoSettingsOpen((open) => !open); }}
            style={{ position: "absolute", top: 11, right: 10, width: 27, height: 27, borderRadius: 8, display: "grid", placeItems: "center", color: K.txt, background: "rgba(255,255,255,.24)", border: `1px solid ${GK.edge}`, backdropFilter: "blur(10px)", opacity: envPhoto?.data ? 1 : .45 }}>
            <Settings size={15} aria-hidden="true" />
          </button>
          </div>
        </div>
        {envPhoto?.data && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="b" onClick={() => onEnv("custom")}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 9, background: envId === "custom" ? K.accDim : K.surf, color: K.txt, fontSize: 11.5, fontWeight: 600 }}>
              Use saved photo
            </button>
            <button type="button" className="b" onClick={() => photoInput.current && photoInput.current.click()}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 9, background: K.surf, color: K.txt, fontSize: 11.5, fontWeight: 600 }}>
              Add new photo
            </button>
          </div>
        )}
        {/* Photo adjustments — only when a photo is the active environment. */}
        {photoSettingsOpen && envId === "custom" && envPhoto?.data && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
            {[
              { k: "zoom",    lbl: "Zoom",       min: 1,    max: 2.5,  step: 0.05 },
              { k: "bright",  lbl: "Brightness", min: 0.45, max: 1.3,  step: 0.05 },
              { k: "blur",    lbl: "Blur",       min: 0,    max: 24,   step: 1 },
              { k: "overlay", lbl: "Dim",        min: 0,    max: 0.75, step: 0.05 },
            ].map((c) => (
              <label key={c.k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: K.sub }}>
                <span style={{ width: 72, flexShrink: 0 }}>{c.lbl}</span>
                <input type="range" min={c.min} max={c.max} step={c.step} aria-label={c.lbl}
                  value={(envPhoto.adj || PHOTO_DEFAULTS)[c.k]}
                  onChange={(ev) => onPhotoAdj({ [c.k]: Number(ev.target.value) })}
                  style={{ flex: 1, accentColor: K.acc }} />
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: K.sub }}>
              <span style={{ width: 72, flexShrink: 0 }}>Position</span>
              <select value={(envPhoto.adj || PHOTO_DEFAULTS).pos} aria-label="Photo position"
                onChange={(ev) => onPhotoAdj({ pos: ev.target.value })}
                style={{ ...inpSt(), flex: 1, padding: "6px 8px" }}>
                <option value="50% 50%">Center</option>
                <option value="50% 20%">Top</option>
                <option value="50% 80%">Bottom</option>
                <option value="20% 50%">Left</option>
                <option value="80% 50%">Right</option>
              </select>
            </label>
          </div>
        )}
        <p style={{ fontSize: 11, color: K.muted, margin: "9px 0 0", lineHeight: 1.55 }}>
          {envId === "custom" ? "Custom photo stays on this device." : user.authLinked ? "Your theme choice syncs with your account." : "Saved on this device — sign in to sync it."} The glass picks up the environment’s colors automatically.
        </p>
        {/* Hidden file input for Add photo. */}
        <input ref={photoInput} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(ev) => {
            const f = ev.target.files && ev.target.files[0];
            ev.target.value = "";
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
              const image = new Image();
              image.onload = () => {
                const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
                onPhoto(canvas.toDataURL("image/jpeg", 0.82));
              };
              image.onerror = () => onPhoto(String(rd.result));
              image.src = String(rd.result);
            };
            rd.readAsDataURL(f);
          }} />
      </div>


      {/* Reminders (device; permission is the browser's, shown honestly) */}
      <div style={{ ...card(), padding: "14px 16px", marginBottom: 12 }}>
        <div style={secLbl}>REMINDERS</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13.5, color: K.txt, fontWeight: 500 }}>Task due-date reminders</div>
            <div style={{ fontSize: 11.5, color: K.muted, marginTop: 2, lineHeight: 1.5 }}>
              One notification per task on its due day, while NORTH is open — the web has no background delivery.
            </div>
          </div>
          <span style={{
            fontSize: 10.5, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5,
            color: notifGranted ? K.ok : notifDenied ? K.err : K.sub,
            padding: "3px 9px", borderRadius: 999,
            background: notifGranted ? K.ok + "18" : notifDenied ? K.err + "14" : K.surf,
          }}>
            {notifGranted ? "ALLOWED" : notifDenied ? "BLOCKED" : "ON DEMAND"}
          </span>
        </div>
        {!notifGranted && !notifDenied && (
          <button type="button" className="b" onClick={askNotif}
            style={{
              display: "flex", alignItems: "center", gap: 6, marginTop: 10,
              fontSize: 12, fontWeight: 600, color: K.acc, padding: "7px 12px", borderRadius: 9,
              background: K.accDim,
            }}>
            Allow notifications
          </button>
        )}
      </div>


      {/* About */}
      <div style={{ ...card(), padding: "14px 16px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 4 }}>
          <Shield size={13} color={K.sub} aria-hidden="true" />
          <span style={{ fontSize: 12, fontWeight: 700, color: K.sub, letterSpacing: 1 }}>NORTH</span>
        </div>
        <div style={{ fontSize: 11, color: K.muted }}>
          Focus, tasks and blocking — synced through your account. Blocking is enforced by the browser extension and the desktop app.
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,  setUser]  = useState(null);
  const extensionConnectRef = useRef("");
  const [extensionConnectStatus, setExtensionConnectStatus] = useState(null);
  useEffect(() => {
    if (!extensionConnectStatus) return undefined;
    const timer = setTimeout(() => setExtensionConnectStatus(null), 10000);
    return () => clearTimeout(timer);
  }, [extensionConnectStatus]);
  const [tab,   setTab]   = useState(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "flow" ? "flow" : "home"; }
    catch { return "home"; }
  });
  useEffect(() => {
    // The page is one scrolling document. Without resetting it, switching from
    // a long Flow report to Focus keeps the old scroll offset and makes the
    // timer/header appear clipped when the user returns to the tab.
    window.scrollTo(0, 0);
  }, [tab]);
  const [boot,  setBoot]  = useState(true);
  const [scrl,  setScrl]  = useState(false); // content overlapping the sticky header?  // ── ENVIRONMENT ────────────────────────────────────────────────────
  const previewHarness = isPreviewHarness();
  // The background IS the theme. A preset id, or "custom" with an uploaded
  // photo + adjustments. Device-local (`fl_env`), plus the photo payload in
  // `fl_env_photo` (data URL, size-checked — this is a wallpaper, not user
  // content for sync). The palette and glass material both derive from the
  // active environment every render pass.
  const [envId, setEnvId] = useState(() => {
    try {
      const v = localStorage.getItem("fl_env");
      if (isKnownEnv(v) || v === "custom") return v;
    } catch {}
    return DEFAULT_ENV_ID;
  });
  const [envPhoto, setEnvPhoto] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("fl_env_photo") || "null"); if (v && v.data) return v; } catch {}
    return null;
  });
  const themeWrite = useRef(Promise.resolve());
  const setEnv = (id) => {
    if (!isKnownEnv(id) && id !== "custom") return;
    setEnvId(id);
    // A custom wallpaper is device-local; only named presets are account
    // preferences. Never let a profile round-trip replace this device's photo.
    if (isKnownEnv(id)) setUser((current) => current ? { ...current, theme: id } : current);
    if (user?.un && isKnownEnv(id)) {
      const un = user.un;
      const intent = { un, id, at: Date.now() };
      try { localStorage.setItem(THEME_INTENT_KEY, JSON.stringify(intent)); } catch {}
      themeWrite.current = themeWrite.current.catch(() => {}).then(async () => {
        const profile = await S.get(PROFILE_KEY(un));
        if (profile) {
          await S.set(PROFILE_KEY(un), { ...profile, theme: id });
          const result = await SYNC.flushProfile(un).catch(() => null);
          if (result?.ok) clearThemeIntent(intent);
        }
        notifyExtension("north-sync");
      });
    }
  };
  const setPhotoAdj = (patch) => setEnvPhoto((p) => {
    const next = p ? { ...p, adj: { ...PHOTO_DEFAULTS, ...(p.adj || {}), ...patch } } : null;
    try { if (next) localStorage.setItem("fl_env_photo", JSON.stringify(next)); } catch {}
    return next;
  });
  const addPhoto = (data) => {
    if (typeof data !== "string" || !data.startsWith("data:image/") || data.length > 4.5 * 1024 * 1024) return false;
    const rec = { data, adj: { ...PHOTO_DEFAULTS } };
    setEnvPhoto(rec);
    setEnv("custom");
    try { localStorage.setItem("fl_env_photo", JSON.stringify(rec)); } catch { /* too large for storage — session-only */ }
    return true;
  };
  const removePhoto = () => {
    setEnvPhoto(null);
    try { localStorage.removeItem("fl_env_photo"); } catch {}
    setEnv(DEFAULT_ENV_ID);
  };
  // Activate the palette + glass tokens for this render pass. A custom photo
  // env derives both from the user's brightness/overlay controls.
  const usingPhoto = envId === "custom" && envPhoto?.data;
  PHOTO_CURRENT = usingPhoto ? envPhoto.adj : null;
  K = usingPhoto ? paletteForCustomPhoto(envPhoto.adj) : paletteOf(envId);
  GK = glassOf(usingPhoto ? "custom" : envId);

  useEffect(() => {
    try { localStorage.setItem("fl_env", envId); } catch {}
  }, [envId]);

  // A password-reset link signs the person in with a PASSWORD_RECOVERY session.
  // Catch that event and route to the set-a-new-password screen instead of
  // silently dropping them into the app.
  const [recovery, setRecovery] = useState(false);

  // ── TASK DUE-DATE REMINDERS ───────────────────────────────────────────
  // State (the ledger) in device storage, decision logic in lib/reminders.js
  // (tested). Ticks on mount and once a minute: cheap when nothing is due.
  // Fires while NORTH is open — the web has no background delivery — and a
  // restart cannot re-fire a key already in the ledger (offline-safe).
  const [remLedger, setRemLedger] = useState(null);
  useEffect(() => {
    let dead = false;
    S.get("north:reminders").then((l) => { if (!dead) setRemLedger(l || {}); });
    return () => { dead = true; };
  }, []);

  // The extension opens this page with a short-lived nonce after the person
  // explicitly chooses Connect. Only the active website session is handed off.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get("connectExtension") || "";
    const nonce = params.get("connectNonce") || "";
    if (!requestedId && !nonce) return;
    if (!/^[a-p]{32}$/.test(requestedId) || !/^[a-zA-Z0-9-]{20,80}$/.test(nonce)) {
      setExtensionConnectStatus({ kind: "error", message: "This extension connection link is invalid. Click Connect to North in the extension and try again." });
      return;
    }
    if (boot) return;
    if (!user?.id) {
      setExtensionConnectStatus({ kind: "info", message: "Sign in to your North account here first. Once signed in, this page will finish connecting the extension automatically." });
      return;
    }
    if (!supabaseConfigured || !supabase) {
      setExtensionConnectStatus({ kind: "error", message: "North account sync is not configured in this website build. Configure Supabase, reload North, then reconnect from the extension." });
      return;
    }
    if (extensionConnectRef.current === nonce) return;
    extensionConnectRef.current = nonce;
    setExtensionConnectStatus({ kind: "info", message: "Connecting the extension to your signed-in North account…" });
    (async () => {
      try {
        // Rotate cached credentials immediately before this one-use handoff.
        // A browser cache can otherwise retain a JWT whose server session was
        // revoked by the preceding sign-out.
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !data?.session) throw new Error("Your North session expired. Sign in to North again, then reconnect the extension.");
        if (data.session.user?.id !== user.id) throw new Error("The signed-in North account changed. Try connecting again.");
        const result = await connectExtensionAccount({
          url: normalizedUrl, anonKey: supabaseAnonKey, webUrl: window.location.origin,
          targetId: requestedId, nonce, session: data.session,
        });
        if (!result.ok) throw new Error(result.reason || "The extension did not confirm the account connection.");
        setExtensionId(requestedId);
        setExtensionConnectStatus(result.synced
          ? { kind: "success", message: `Extension connected and synced with your North account${result.version ? ` (extension v${result.version})` : ""}. The popup will show the last successful sync time.` }
          : { kind: "error", message: `The account connected, but its first sync failed${result.syncReason ? `: ${result.syncReason}` : ""}. Keep North open and use Sync now after checking the extension popup.` });
        params.delete("connectExtension");
        params.delete("connectNonce");
        const query = params.toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      } catch (error) {
        extensionConnectRef.current = "";
        const reason = error?.message || "connection failed";
        const message = reason === "extension_outdated"
          ? "This browser has an older NORTH extension loaded. Open brave://extensions (or chrome://extensions), click Reload on NORTH Flow, then click Connect to North again."
          : `Could not connect the extension: ${reason}. Keep this page open and click Connect to North in the extension to retry.`;
        setExtensionConnectStatus({ kind: "error", message });
        console.warn("[north] extension connection did not complete:", error?.message || error);
      }
    })();
  }, [user?.id, boot]);
  // Reminders v2: one ledger, four kinds (due-today / upcoming / overdue /
  // calendar event). The plan fires each key at most once per day; completed
  // or deleted tasks and vanished events are cancelled from the ledger; the
  // per-task `remindOn: "none"` preference silences an individual task.
  useEffect(() => {
    if (!user || remLedger === null) return undefined;
    let running = false; // one tick at a time — the interval must never stack
    const fire = async () => {
      if (running) return;
      running = true;
      try {
      const now = Date.now();
      const today = dayOf(now);
      const cleaned = cancelStaleReminders(remLedger, user.tasks, []);
      const plan = buildReminderPlan(user.tasks, [], today, cleaned, { leadDays: 1 });
      if (!plan.length) {
        // cancelStaleReminders always returns a NEW object, so an identity
        // compare here (`cleaned !== remLedger`) is always true and this effect
        // would setState → re-run → setState in an infinite loop. Compare
        // content: only persist when an entry was actually dropped.
        const dropped = Object.keys(remLedger || {}).length !== Object.keys(cleaned).length ||
          Object.keys(remLedger || {}).some((k) => remLedger[k] !== cleaned[k]);
        if (dropped) { setRemLedger(cleaned); await S.set("north:reminders", cleaned); }
        return;
      }
      for (const item of plan) {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const body =
              item.kind === "due-today" ? `Due today: ${item.title}` :
              item.kind === "upcoming" ? `Coming up: ${item.title}` :
              item.kind === "overdue" ? `Overdue: ${item.title}` :
              `Today's task: ${item.title}`;
            new Notification("NORTH", { body, tag: item.key });
          }
        } catch { /* notification unavailable — the ledger still records it */ }
      }
      const nextLedger = recordFired(plan.map((p) => p.key), today, cleaned, now);
      setRemLedger(nextLedger);
      await S.set("north:reminders", nextLedger);
      } finally { running = false; }
    };
    fire();
    const iv = setInterval(fire, 60000);
    return () => clearInterval(iv);
  }, [user, remLedger]);
  // Adopt the account's saved environment at sign-in. The web persists the
  // environment preference into profiles.settings.theme (a plain string id);
  // photo payloads stay device-local — the account carries only the choice.
  // Deliberately sequential, not a race: the cloud value is peeked BEFORE
  // bootstrap so a stale local value can never overwrite the cloud one.
  const applyAccountTheme = async (profile) => {
    const pending = readThemeIntent(profile.un);
    if (pending && !isKnownEnv(pending.id)) clearThemeIntent(pending);
    // Keep a wallpaper explicitly selected on this device across reloads and
    // account hydration. Preset themes can sync; uploaded image data cannot.
    if (envId === "custom" && envPhoto?.data) return profile;
    // A freshly chosen theme is written synchronously before its network push.
    // If the page closes or reloads mid-request, recover that intent before
    // pulling the older account copy; clear it only after the push succeeds.
    if (pending && isKnownEnv(pending.id)) {
      setEnvId(pending.id);
      const next = { ...profile, theme: pending.id };
      await S.set(PROFILE_KEY(profile.un), next);
      const result = await SYNC.flushProfile(profile.un).catch(() => null);
      if (result?.ok) clearThemeIntent(pending);
      return next;
    }
    let cloud = null;
    try { cloud = await SYNC.peekTheme(); } catch { /* offline → null */ }
    if (cloud && isKnownEnv(cloud)) {
      const theme = cloud;
      setEnvId(theme);
      const next = { ...profile, theme };
      try { await S.set(PROFILE_KEY(profile.un), next); } catch { /* memory still follows cloud */ }
      return next;
    }
    if (profile.theme && isKnownEnv(profile.theme)) {
      const theme = profile.theme;
      setEnvId(theme);
      if (theme !== profile.theme) {
        const next = { ...profile, theme };
        try { await S.set(PROFILE_KEY(profile.un), next); } catch { /* in-memory appearance still follows */ }
        return next;
      }
      return profile;
    }
    // Nothing on the cloud yet: this device's choice is the newest intent.
    try {
      const p = await S.get(`u:${profile.un}`);
      if (p) await S.set(`u:${profile.un}`, { ...p, theme: envId });
    } catch { /* storage unavailable — env just stays device-local */ }
    return { ...profile, theme: envId };
  };

  // Scroll-edge chrome (apple-design skill §12): the frosted header carries no
  // hard divider — a hairline appears only once content actually scrolls under
  // it, then disappears again at the top of the page.
  useEffect(() => {
    const on = () => setScrl(window.scrollY > 2);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // ── ACCOUNT ──────────────────────────────────────────────────────────────
  // One load path for the device record: boot, sign-in and navigation all go
  // through `loadProfile`, so a profile is never half-hydrated. `hydrateProfile`
  // fills in defaults and upgrades records written before blocking existed.
  async function loadProfile(un) {
    if (!un) return null;
    const raw = await S.get(PROFILE_KEY(un));
    return raw ? hydrateProfile(raw, { un, migrate: migrateLegacy }) : null;
  }

  const saveProfile = async (profile) => S.set(PROFILE_KEY(profile.un), profile);

  /**
   * A profile stored under a different username but the same email — an account
   * first created with a username, later signed into with Google. Without this
   * lookup the same person would silently get a second, empty profile.
   */
  const findProfileByEmail = async (email) => {
    if (!email) return null;
    const keys = await S.list("u:");
    for (const key of keys) {
      const raw = await S.get(key);
      if (raw?.email && String(raw.email).toLowerCase() === String(email).toLowerCase()) return raw;
    }
    return null;
  };

  /**
   * THE single place an app user is built. Previously the Supabase user was
   * passed straight in, so `un` was undefined, every screen read `u:undefined`,
   * and the header crashed on `(user.name || user.un)[0]`. Now identity comes
   * from the shared mapper and the profile is created on first sign-in.
   *
   * `oauthIntent` is non-null ONLY for OAuth arrivals — the auth screen
   * leaves a session-storage note that survives the provider redirect, and
   * the boot path consumes it. Password paths and ordinary session restores
   * pass null and are never gated (a probe failure must never lock someone
   * out of an account Supabase just authenticated). For a gated arrival, an
   * unknown account from the sign-in intent is signed back out and refused;
   * from the sign-up intent it is admitted and profiled as a new account.
   */
  const adoptAccount = async (accountUser, oauthIntent = null) => {
    // OAuth gate: does this fresh session already have a North account?
    // Only consulted when the provider may have created a brand-new auth user
    // AND the person was on the sign-in screen (supabase-js carries no
    // is-new-user flag through the redirect, so this is the honest check).
    if (accountUser?.id && oauthIntent === "signin") {
      const exists = await SYNC.hasAccount();
      const verdict = resolveOAuthIntent({ accountExists: exists, intent: oauthIntent });
      if (verdict.action === "refuse") {
        try { if (supabaseConfigured && supabase) await supabase.auth.signOut(); } catch {}
        SYNC.detach();
        return { refused: verdict.reason, email: accountUser?.email || "" };
      }
    }
    const un = usernameFromEmail(accountUser?.email, accountUser?.id);
    const existing =
      (await loadProfile(un)) || (await findProfileByEmail(accountUser?.email));
    const profile =
      existing ||
      defaultProfile({
        un,
        name: accountUser?.user_metadata?.name,
        email: accountUser?.email,
      });
    if (!existing) await saveProfile(profile);
    const mapped = toAppUser(accountUser, profile);
    await S.set(SESSION_KEY, {
      un: mapped.un,
      id: accountUser?.id || "",
      authLinked: Boolean(accountUser?.id),
    });

    // Link this device to the account and adopt the account's copy of the data.
    // `bootstrap` pushes what this device already holds *before* pulling, so a
    // record made before signing in is never discarded by the first sync.
    SYNC.attach({ userId: accountUser?.id, un: mapped.un });
    if (accountUser?.id) {
      // Resolve the theme from the cloud BEFORE bootstrap, so the first push
      // carries the resolved value rather than a stale local preference.
      const themed = await applyAccountTheme(mapped).catch(() => mapped);
      await SYNC.bootstrap(mapped.un).catch(() => {});
      let fromAccount = await loadProfile(mapped.un);
      const pendingTheme = readThemeIntent(mapped.un);
      if (pendingTheme && isKnownEnv(pendingTheme.id) && fromAccount) {
        fromAccount = { ...fromAccount, theme: pendingTheme.id };
        await S.set(PROFILE_KEY(mapped.un), fromAccount);
        const result = await SYNC.flushProfile(mapped.un).catch(() => null);
        if (result?.ok) clearThemeIntent(pendingTheme);
      }
      if (fromAccount) {
        if (envId !== "custom" && fromAccount.theme && isKnownEnv(fromAccount.theme)) setEnvId(fromAccount.theme);
        return toAppUser(accountUser, fromAccount);
      }
      return themed;
    }
    return mapped;
  };

  // A Google arrival that was refused: new account via the sign-in screen.
  // The session has already been signed out inside adoptAccount; this state
  // only drives the Auth screen's explanation and its path to Sign up.
  const [oauthRefused, setOauthRefused] = useState(null);

  const logout = async () => {
    // Sign out of the account service too — otherwise the Supabase session
    // survives and the person is silently signed back in on reload.
    try { if (supabaseConfigured && supabase) await supabase.auth.signOut(); } catch {}
    await S.del(SESSION_KEY);
    SYNC.detach();
    setUser(null);
    setTab("home");
  };

  // Keep the whole website aligned with Supabase after boot. Password auth,
  // OAuth returns, token refreshes, cross-tab sign-out and account updates all
  // pass through this one boundary. Supabase advises keeping the callback
  // synchronous, so account I/O is queued outside it.
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return undefined;
    let live = true;
    let transition = 0;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      const accountUser = authEventUser(event, session);
      if (accountUser === undefined) return;
      const ticket = ++transition;
      queueMicrotask(async () => {
        if (!live || ticket !== transition) return;
        if (!accountUser) {
          await S.del(SESSION_KEY).catch(() => {});
          SYNC.detach();
          if (live && ticket === transition) {
            setUser(null);
            setTab("home");
          }
          return;
        }
        const mapped = await adoptAccount(accountUser).catch(() => null);
        if (mapped && live && ticket === transition) setUser(mapped);
      });
    });
    return () => {
      live = false;
      try { data?.subscription?.unsubscribe(); } catch { /* already gone */ }
    };
    // Auth subscription is intentionally installed once for this app mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot: the device record first (so the app works offline and with no account
  // service configured), then Supabase's own session, which wins over it.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const sess = await S.get(SESSION_KEY);
        if (sess?.un) {
          const u = await loadProfile(sess.un);
          if (u && !dead) setUser(cachedSessionUser(u, sess));
        }
        if (supabaseConfigured && supabase) {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user && !dead) {
            // An OAuth redirect lands as a fresh page load with a session in
            // the URL. The auth screen left a session-storage note recording
            // which tab the person used; consume it (once) and enforce the
            // intent here. No note → ordinary session restore, never gated.
            let oauthIntent = null;
            try {
              // The note is only present when this page load IS the OAuth
              // return (Auth writes it right before bouncing to Google, and
              // the same tab lands back here). A plain session restore —
              // reload, reopen, another device's session — never has one, so
              // restores are never gated by the intent check.
              const note = sessionStorage.getItem("north:oauth-intent");
              if (note) {
                oauthIntent = note;
                sessionStorage.removeItem("north:oauth-intent");
              }
            } catch {}
            const result = await adoptAccount(data.session.user, oauthIntent);
            if (result?.refused) setOauthRefused(result);
            else setUser(result);
          }
        }
      } catch { /* a broken account service must never block boot */ }
      if (!dead) setBoot(false);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every screen renders from the in-memory `user` object, but edits (tasks,
  // friends, apps, block rules) are persisted to storage by whichever screen
  // made them. Reload the user record on navigation so no screen shows stale
  // data after another screen changed it.
  const goTab = (id) => {
    setTab(id);
    themeWrite.current.catch(() => {}).then(() => loadProfile(user.un)).then((u) => {
      if (u) {
        // The stored profile carries the DATA; the session carries the IDENTITY
        // (`authLinked`, the Supabase uid). Replacing wholesale would strip the
        // identity fields on every navigation and make a signed-in account
        // render as "Device only", so merge and keep what Supabase vouched for.
        setUser((p) => (p && p.un === user.un ? { ...u, id: p.id || u.id, authLinked: p.authLinked || u.authLinked } : p));
        // Another signed-in device may have changed the account environment;
        // the pulled profile is the newest statement of intent, so follow it.
        // Uploaded wallpapers are a device-local override, never replaced by
        // the account's preset while refreshing a screen.
        if (!(envId === "custom" && envPhoto?.data) && isKnownEnv(u.theme)) setEnvId(u.theme);
      }
    });
  };  const TABS = [
    { id: "home",     I: HomeIcon,   lbl: "Home"   },
    { id: "focus",    I: Timer,      lbl: "Focus"  },
    { id: "tasks",    I: ListChecks, lbl: "Tasks"  },
    { id: "calendar", I: Calendar,   lbl: "Calendar" },
    { id: "flow",     I: Shield,     lbl: "Flow"    },
    { id: "social",   I: Users,      lbl: "Social" },
    { id: "settings", I: Settings,   lbl: "Settings" },
  ];

  // Unread friend-request badge: rows pointing at my username with status
  // 'pending' (migration 003's incoming-read policy). Read once per account
  // change and after any return to the Social tab; fails silently offline —
  // a badge must never break boot. Cleared locally when the tab is opened.
  const [pendingReqCount, setPendingReqCount] = useState(0);
  const onSocial = tab === "social";
  useEffect(() => {
    let dead = false;
    if (!user?.un) return undefined;
    const read = () => {
      if (!supabaseConfigured || !supabase) return;
      supabase
        .from("friends")
        .select("user_id", { count: "exact", head: true })
        .eq("friend_un", user.un)
        .eq("status", "pending")
        .then(({ count, error }) => { if (!dead && !error && Number.isFinite(count)) setPendingReqCount(count); })
        .catch(() => {});
    };
    read();
    const iv = setInterval(read, 120000); // refresh every two minutes while open
    return () => { dead = true; clearInterval(iv); };
  }, [user?.un, onSocial]); // re-check right after viewing Social

  const pages = user ? {
    home:     <Home     user={user} go={goTab} />,
    focus:    <Focus    user={user} envId={envId} envPhoto={envPhoto} go={goTab} />,
    tasks:    <Tasks    user={user} go={goTab} />,
    calendar: <Cal      user={user} />,
    flow:     <Blocking user={user} />,
    social:   <Social   user={user} />,
    settings: <SettingsScreen user={user} envId={envId} envPhoto={envPhoto} onEnv={setEnv} onPhoto={addPhoto} onPhotoAdj={setPhotoAdj} onRemovePhoto={removePhoto} onLogout={logout} onName={(name) => setUser((p) => p ? { ...p, name } : p)} go={goTab} />,
  } : {};

  /* ── LOADING ── */
  if (boot) return (
    <>
      {G()}
      <div style={{ ...GLASS_ENV(envId, envPhoto), display: "flex", alignItems: "center", justifyContent: "center" }}>
        {ENV_WALL_LAYER(envId)}
        {ENV_PHOTO_LAYER(envId, envPhoto)}
        <Compass size={36} color={K.acc} />
      </div>
    </>
  );

  /* ── AUTH ── */
  if (!user) return (
    <Auth
      noAccount={oauthRefused}
      onDismissNoAccount={() => setOauthRefused(null)}
      envId={envId}
      envPhoto={envPhoto}
      extensionConnectStatus={extensionConnectStatus}
      onDismissExtensionStatus={() => setExtensionConnectStatus(null)}
    />
  );

  /* ── PASSWORD RESET (arrived from the reset email) ── */
  if (recovery) {
    return <SetPassword onDone={() => setRecovery(false)} envId={envId} envPhoto={envPhoto} />;
  }

  /* ── APP SHELL — floating glass chrome over the living environment ── */
  return (
    <div className="genv" style={{ ...GLASS_ENV(envId, envPhoto), fontFamily: FONT }}>
      {ENV_WALL_LAYER(envId)}
      {ENV_PHOTO_LAYER(envId, envPhoto)}
      {G()}
      {extensionConnectStatus && (
        <div role={extensionConnectStatus.kind === "error" ? "alert" : "status"} style={{
          position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          width: "min(560px, calc(100vw - 32px))", padding: "11px 14px", borderRadius: 12,
          fontSize: 12, lineHeight: 1.45, color: extensionConnectStatus.kind === "error" ? K.err : K.txt,
          background: K.surf, border: `1px solid ${extensionConnectStatus.kind === "error" ? `${K.err}66` : `${K.acc}66`}`,
          backdropFilter: "blur(18px)", boxShadow: "0 8px 28px rgba(0,0,0,.22)",
            display: "flex", alignItems: "center", gap: 9,
          }}>
            <img src="/north-logo.png" alt="" width="20" height="20" style={{ objectFit: "contain", flex: "0 0 auto" }} />
            <span style={{ flex: 1 }}>{extensionConnectStatus.message}</span>
            <button type="button" className="b" onClick={() => setExtensionConnectStatus(null)} aria-label="Dismiss message" title="Dismiss" style={{ color: K.txt, padding: 2 }}><X size={15} /></button>
          </div>
      )}
      {/* Desktop sidebar — the shell's permanent navigation. Text-only labels
          (no icons): the page names carry it. The active page is a quiet
          accent wash; the account sits at the bottom, above the edge. */}
      <aside className="north-sidebar">
        <div className="north-brand">
          <img src="/north-logo.png" alt="" width="28" height="28" style={{ objectFit: "contain" }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: K.txt, letterSpacing: -0.2 }}>NORTH</span>
        </div>
        <nav className="north-nav" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="b north-nav-item" onClick={() => goTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: tab === t.id ? 650 : 500, lineHeight: 1.2 }}>
                {t.id === "settings" ? "Settings" : t.lbl}
              </span>
              {t.id === "social" && pendingReqCount > 0 && (
                <span className="north-badge" aria-label={`${pendingReqCount} pending friend request${pendingReqCount === 1 ? "" : "s"}`}>{pendingReqCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="north-sidebar-spacer" />
        <button type="button" className="b north-account" onClick={() => goTab("settings")}
          aria-label={`Account — open settings for ${displayName(user)}`}
          style={{ borderRadius: 10, textAlign: "left" }}>
          <span className="north-avatar" aria-hidden="true">{initial(user)}</span>
          <span className="north-un" style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{displayName(user)}</span>
        </button>
      </aside>
      {/* Top bar — primary glass, full-bleed but translucent: the environment
          pools show through it, and content scrolls beneath its lens. */}
      <header className="mtrl nhead" style={{
        position: "sticky", top: 0, zIndex: 20,
        ...glassHeader(GK),
        boxShadow: scrl
          ? `inset 0 1px 0 ${GK.hi}, 0 1px 0 ${GK.edge}, 0 12px 32px -12px rgba(0,0,0,${K.dark ? ".45" : ".12"})`
          : `inset 0 1px 0 ${GK.hi}`,
        transition: "box-shadow .25s ease",
      }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 20px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {/* Brand — mobile only; on desktop it lives in the sidebar. */}
            <div className="mbrand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/north-logo.png" alt="" width="30" height="30" style={{ objectFit: "contain" }} />
              <span style={{ fontSize: 17, fontWeight: 800, color: K.txt, letterSpacing: -0.4 }}>NORTH</span>
            </div>
            {/* Actions — mobile only; the header itself is desktop-hidden. */}
            <div className="nhead-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                title={displayName(user)}
                aria-label={`Signed in as ${displayName(user)}`}
                style={{
                  width: 30, height: 30, borderRadius: 9, background: K.acc,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: K.onAcc, fontSize: 12, fontWeight: 800,
                  boxShadow: `0 2px 8px ${K.acc}55, inset 0 1px 0 rgba(255,255,255,.35)`,
                }}>{initial(user)}</div>
              <button type="button" className="b" onClick={logout}
                style={{ fontSize: 12, color: K.sub, padding: "4px 2px" }}>Sign out</button>
            </div>
          </div>
        </div>
      </header>

      {/* ─ Content ─ */}
      <main key={tab} className="pge north-content" style={{ position: "relative", zIndex: 1 }}>
        {previewHarness && (
          <div role="status" style={{
            margin: "14px 20px 0", padding: "9px 12px", borderRadius: 10,
            background: K.warn + "16", border: `1px solid ${K.warn}44`,
            color: K.txt, fontSize: 12.5, lineHeight: 1.45,
          }}>
            Preview data only — this is not a signed-in account. <a href="/" style={{ color: K.acc, fontWeight: 650 }}>Open the live local app</a> to use your account.
          </div>
        )}
        {/* key forces a fresh mount on tab change: Focus reads the pomodoro
            profile into local state once, and without a remount a duration
            edited on the Settings page wouldn't reach the dial until reload. */}
        <div key={tab} style={{ display: "contents" }}>
          {pages[tab]}
        </div>
        <div style={{ height: 110 }} aria-hidden="true" />
      </main>

      {/* Floating navigation — MOBILE/TABLET ONLY (the .ndock class hides it
          on ≥801px viewports, where the sidebar takes over). Same tabs, same
          goTab behavior; each tab is a glass pill with the active one lit. */}
      <nav aria-label="Main" className="ndock north-mobile-nav" style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 18,
        zIndex: 30, maxWidth: "calc(100vw - 24px)",
        display: "flex", gap: 4, padding: 6, borderRadius: 22,
        overflowX: "auto",
        ...glassFloat(GK),
        boxShadow: `inset 0 1px 0 ${GK.hi}, inset 0 -1px 0 rgba(0,0,0,${K.dark ? ".18" : ".04"}), ${GK.shFloat}`,
      }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" className="b nv" onClick={() => goTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            aria-label={t.lbl}
            title={t.lbl}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              flexShrink: 1, minWidth: 0, padding: "8px 6px 7px", borderRadius: 14,
              position: "relative",
              ...(tab === t.id
                ? { background: K.dark ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.55)",
                    boxShadow: `inset 0 1px 0 ${GK.hi}, 0 2px 10px ${K.acc}30` }
                : { background: "transparent", boxShadow: "none" }),
              color: tab === t.id ? K.acc : K.sub,
              transition: "background-color .2s ease, box-shadow .2s ease",
            }}>
            <t.I aria-hidden="true" size={18} strokeWidth={2.2} color={tab === t.id ? K.acc : K.muted} />
            <span style={{ fontSize: 9.5, fontWeight: tab === t.id ? 700 : 500, letterSpacing: 0.2 }}>
              {t.lbl}
            </span>
            {/* Friend-request badge: only when requests are waiting. */}
            {t.id === "social" && pendingReqCount > 0 && (
              <span aria-label={`${pendingReqCount} pending friend request${pendingReqCount === 1 ? "" : "s"}`}
                style={{
                  position: "absolute", top: 4, right: 8,
                  minWidth: 15, height: 15, padding: "0 4px", borderRadius: 999,
                  background: K.err, color: "#fff", fontSize: 9, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,.25)",
                }}>{pendingReqCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
