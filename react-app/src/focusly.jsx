import { useState, useEffect, useRef } from "react";
import {
  Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Compass,
  Flame, Home as HomeIcon, LayoutGrid, ListChecks, Moon, Pause, PenLine, Play,
  Plus, RotateCcw, Settings, Shield, SkipForward, Sun, Timer, Trash2, Users, X, Eye, EyeOff
} from "lucide-react";
import { supabase, supabaseConfigured } from "./lib/supabase.js";
// Shared-with-every-client modules (generated copies of packages/shared-types —
// see scripts/sync-shared.mjs). The account mapper and the blocking engine live
// there so the web app, the extension and the phone can never disagree about
// who the user is or what should be blocked.
import {
  migrateLegacy, normalizeHost, normalizeApp, newRule, newSchedule, rulesByKind,
  normalizeState,
  describeBlocking, evaluateBlocking, upsertRule, removeRule, setRuleEnabled,
  upsertSchedule, removeSchedule, unblockUntil,
  RULE_WHEN_LABEL, WORKDAYS, WEEKDAY_LABELS, CLIENT_CAPABILITIES, defaultBlocking,
  startFocus as startFocusSession,
} from "./shared/blocking.js";
import {
  PROFILE_KEY, SESSION_KEY, toAppUser, defaultProfile, hydrateProfile, initial,
  usernameFromEmail, displayName,
} from "./shared/account.js";
// The backend. `createSync` translates the app's storage keys into the tables in
// supabase/schema.sql and mirrors every write; the local store below stays the
// instant, offline-capable cache in front of it. Nothing else in the UI changes.
import { createSync, newUuid } from "./lib/sync.js";


// ── DESIGN TOKENS ──────────────────────────────────────────────────────
// Two palettes (light + dark); `K` points at the active one and is swapped
// by App on toggle. Every color in the UI must come from K so the theme
// switches cleanly — never hardcode hex in components.
// Light follows Apple's iOS "grouped" surface — light gray canvas, white
// cards, hairline separators, system blue. Dark follows iOS dark mode:
// pure-black canvas, elevated dark-gray materials, Apple system colors.
const L = {
  bg: "#F2F2F7", surf: "#F1F2F6", card: "#FFFFFF", card2: "#FFFFFF", border: "#E2E3E9",
  acc: "#007AFF", accDim: "#E8F1FE",
  ok: "#34C759", warn: "#FF9500", err: "#FF3B30",
  txt: "#1C1C1E", sub: "#6D6D72", muted: "#AFAFB6",
  sh1: "0 1px 2px rgba(0, 0, 0, 0.04)",
  sh2: "0 1px 3px rgba(0, 0, 0, 0.05)",
  sh3: "0 -6px 12px rgba(0, 0, 0, 0.03)",
};
const D = {
  bg: "#000000", surf: "#1C1C1E", card: "#1C1C1E", card2: "#242428", border: "#38383A",
  acc: "#0A84FF", accDim: "#0E3160",
  ok: "#30D158", warn: "#FF9F0A", err: "#FF453A",
  txt: "#F2F2F7", sub: "#98989E", muted: "#636366",
  sh1: "0 1px 2px rgba(0, 0, 0, 0.5)",
  sh2: "0 1px 3px rgba(0, 0, 0, 0.55)",
  sh3: "0 -6px 12px rgba(0, 0, 0, 0.45)",
};
let K = L; // active palette — App reassigns this before rendering on toggle
// Active right-click policy for this render pass (same pattern as `K`). It is a
// VIEW preference only — it never changes what is blocked — and its default,
// "native", means NORTH does not touch the browser's own menu at all.
let CTX = "native";

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
  async list(prefix, shared = false) {
    // The leaderboard is the one shared list that must be live rather than
    // cached: it is an aggregate on the server, not rows this device holds.
    if (shared && prefix === "lb:" && SYNC && SYNC.ready()) {
      await SYNC.leaderboard().catch(() => {});
    }
    try { const r = await pick().list(prefix, shared); return r?.keys || []; }
    catch { return []; }
  },
};

SYNC = createSync({ store: S });

// ── HELPERS ──────────────────────────────────────────────────────────────
// Ids are UUIDs: the database's primary keys are `uuid`, so the same id is
// valid on every client and each write becomes idempotent (a focus session
// pushed twice updates one row instead of creating a duplicate).
const uid  = () => newUuid();
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
// every render.
const card  = () => ({ background: K.card,  borderRadius: 14, border: `1px solid ${K.border}`, padding: "14px 16px", boxShadow: K.sh1 });
const card2 = () => ({ background: K.card2, borderRadius: 12, border: `1px solid ${K.border}`, padding: "12px 14px" });
const inpSt = () => ({
  width: "100%", padding: "10px 12px", borderRadius: 10, boxSizing: "border-box",
  background: K.surf, border: `1px solid ${K.border}`, color: K.txt,
  fontSize: 13, fontFamily: "inherit",
});
const tag = (active, col) => ({
  padding: "4px 11px", borderRadius: 20, fontSize: 11, cursor: "pointer",
  fontWeight: 500, transition: "all .15s",
  background: active ? col + "22" : K.surf,
  border: `1px solid ${active ? col : K.border}`,
  color: active ? col : K.sub,
});

// ── RIGHT-CLICK / CONTEXT MENU ───────────────────────────────────────────
// NORTH does not override the browser's context menu unless asked to: "native"
// is the default, and on that setting no handler calls preventDefault anywhere.
// The preference exists because some people would rather get the app's own
// actions on a card they right-click. Two rules hold in both modes:
//   · Text fields always keep the native menu. Paste, spell-check, autofill and
//     "search with…" live there; taking them away costs the user more than it
//     gives NORTH, and nothing here should weaken that.
//   · Wherever NORTH has no action to offer, the native menu is allowed through.
const CTX_MODES = [
  { id: "native", lbl: "Browser",    hint: "The browser's own menu everywhere. Nothing is intercepted." },
  { id: "north",  lbl: "NORTH menu", hint: "NORTH's own actions when you right-click a task or a block rule." },
];
const ctxMode = (raw) => (CTX_MODES.some((m) => m.id === raw) ? raw : "native");
const readCtxPreference = () => {
  try { return ctxMode(localStorage.getItem("fl_ctx")); } catch { return "native"; }
};

/** True when the native menu must be left untouched (editable field, or native mode). */
const keepNativeMenu = (el) => {
  if (CTX !== "north") return true;
  const t = el?.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el?.isContentEditable === true;
};

/** Per-screen context-menu state. `openMenu` is a no-op unless the device asked for NORTH's menu. */
const useContextMenu = () => {
  const [menu, setMenu] = useState(null);
  const closeMenu = () => setMenu(null);
  const openMenu = (e, items) => {
    if (keepNativeMenu(e.target) || !items || !items.length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  return { menu, openMenu, closeMenu };
};

// NORTH's own menu: fixed-position, clamped to the viewport, dismissed by Esc,
// an outside press, a scroll or by picking an item. It never traps focus, and
// it never suppresses the native menu anywhere else.
const ContextMenu = ({ menu, onClose }) => {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!menu) { setPos(null); return undefined; }
    const inside = (e) => ref.current && ref.current.contains(e.target);
    const away = (e) => { if (!inside(e)) closeRef.current(); };
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Measure once mounted, then keep the panel inside the window.
  useEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top:  Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);

  if (!menu) return null;
  return (
    <div ref={ref} role="menu" aria-label="NORTH actions"
      style={{
        position: "fixed", left: pos ? pos.left : menu.x, top: pos ? pos.top : menu.y,
        visibility: pos ? "visible" : "hidden", zIndex: 60, minWidth: 184,
        padding: 5, borderRadius: 12, background: K.card,
        border: `1px solid ${K.border}`, boxShadow: K.sh2,
      }}>
      {menu.items.map((it) => (
        <button key={it.lbl} type="button" role="menuitem" className="b"
          onClick={() => { closeRef.current(); it.run(); }}
          style={{
            display: "block", width: "100%", textAlign: "left",
            padding: "7px 9px", borderRadius: 8, fontSize: 12.5,
            color: it.danger ? K.err : K.txt,
          }}>{it.lbl}</button>
      ))}
    </div>
  );
};

// Small injected stylesheet (hover/press/focus need real CSS, inline styles
// can't do :hover). Rendered with the active palette by every top-level view.
// Follows the apple-design skill: response on pointer-down (instant press),
// transform/opacity-only motion, calm page arrival, and OS motion + trans-
// parency preferences honored instead of fought.
const G = (dark) => (
  <style>{`
    :root { color-scheme: ${dark ? "dark" : "light"}; }
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
    /* Respect OS motion + transparency preferences (apple-design skill).
       Reduced motion swaps motion for plain opacity/color state changes. */
    @media (prefers-reduced-motion: reduce) {
      /* Replace motion with a short opacity-only cross-fade (skill §14). */
      .pge { animation: pgeFade .18s ease both; }
      @keyframes pgeFade { from { opacity: 0; } to { opacity: 1; } }
      .b { transition: opacity .1s ease; }
      .b:active { transform: none; }
    }
    /* Frosted chrome becomes solid when the OS asks for less transparency. */
    @media (prefers-reduced-transparency: reduce) {
      .mtrl { background: ${dark ? "#1C1C1E" : "#FFFFFF"} !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    }
    /* Desktop hover: a quiet tint previews the press (web complements the
       touch-only press feedback with a hover state — skill §1/§10). */
    .nv:not([aria-current]):hover { background: ${K.border}55 !important; }
    .nv:not([aria-current]):active { transform: scale(.97); }
  `}</style>
);

// ══════════════════════════════════════════════════════════════════════════
// THEME SWITCH
// ══════════════════════════════════════════════════════════════════════════
// Device preferences. Deliberately small and local: these are settings that
// belong to THIS device (like the theme), never to the account, so they are
// not synced and are never part of the shared blocking/account model.
function Preferences({ ctx, onCtx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current || !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = CTX_MODES.find((m) => m.id === ctx) || CTX_MODES[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="b" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="dialog" aria-label="Preferences" title="Preferences"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 26, borderRadius: 999,
          background: K.surf, border: `1px solid ${K.border}`, color: K.sub,
        }}>
        <Settings size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>

      {open && (
        <div role="dialog" aria-label="Preferences"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 50,
            width: 272, padding: 12, borderRadius: 14, background: K.card,
            border: `1px solid ${K.border}`, boxShadow: K.sh2,
          }}>
          <div style={{ fontSize: 10, letterSpacing: 0.6, color: K.sub, marginBottom: 8 }}>
            RIGHT-CLICK MENU
          </div>
          <div role="radiogroup" aria-label="Right-click menu"
            style={{ display: "flex", background: K.surf, borderRadius: 10, padding: 3, border: `1px solid ${K.border}`, marginBottom: 8 }}>
            {CTX_MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={ctx === m.id}
                className="b" onClick={() => onCtx(m.id)}
                style={{
                  flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                  background: ctx === m.id ? K.card : "transparent",
                  color: ctx === m.id ? K.txt : K.sub,
                  boxShadow: ctx === m.id ? K.sh1 : "none", transition: "all .2s",
                }}>{m.lbl}</button>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: K.muted, margin: 0, lineHeight: 1.55 }}>
            {active.hint} Text fields always keep the browser's menu. Saved on this device only.
          </p>
        </div>
      )}
    </div>
  );
}

// Visible sun/switch/moon control (user requirement — default theme is light).
const ThemeSwitch = ({ dark, onToggle }) => (
  <button type="button" className="b" role="switch" aria-checked={dark}
    aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    title={dark ? "Light theme" : "Dark theme"}
    onClick={onToggle}
    style={{
      display: "flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999,
      background: K.surf, border: `1px solid ${K.border}`,
      color: K.sub, fontSize: 12, fontWeight: 600,
    }}>
    <Sun size={13} strokeWidth={2.2} color={dark ? K.muted : K.warn} aria-hidden="true" />
    <span aria-hidden="true" style={{
      position: "relative", width: 32, height: 19, borderRadius: 999, flexShrink: 0,
      background: dark ? K.acc : K.muted + "66", transition: "background .2s",
    }}>
      <span style={{
        position: "absolute", top: 2, left: dark ? 15 : 2, width: 15, height: 15,
        borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)",
        transition: "left .18s ease",
      }} />
    </span>
    <Moon size={13} strokeWidth={2.2} color={dark ? K.acc : K.muted} aria-hidden="true" />
  </button>
);

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

function Auth({ onLogin, dark, onTheme }) {
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
  const switchMode = (m) => { setMode(m); setErr(""); setInfo(""); };

  const submit = async () => {
    // Enter inside a field calls this directly and bypasses the disabled button,
    // so the guard has to live here too or a held key could fire the request
    // repeatedly. Sign-in and sign-up both pass through this one check.
    if (busy) return;
    if (!supabaseConfigured) { setErr(NO_ACCOUNTS); setInfo(""); return; }
    setBusy(true); setErr(""); setInfo("");
    if (mode === "login") {
      if (!f.email || !f.pass) { setErr("Email and password required."); setBusy(false); return; }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: f.email,
        password: f.pass,
      });
      if (error) { setErr(error.message); setBusy(false); return; }
      await onLogin(data.user);
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
        // in. Hand the account up and let App create the profile record.
        await onLogin(data.session.user);
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
      position: "relative", minHeight: "100vh",
      background: "radial-gradient(at 0% 0%, rgba(170, 59, 255, 0.15) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(64, 150, 255, 0.15) 0px, transparent 50%)",
      backgroundColor: K.bg,
      display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: FONT,
    }}>
      {G(dark)}
      <div style={{ position: "absolute", top: 18, right: 18 }}>
        <ThemeSwitch dark={dark} onToggle={onTheme} />
      </div>

      {/* Frosted card. The translucency is theme-aware (a white sheet in dark
          mode is a light-mode leak), and `.mtrl` turns it solid when the OS asks
          for less transparency. */}
      <div className="mtrl" style={{
        width: "100%", maxWidth: 400, borderRadius: 22,
        padding: "28px 26px", boxShadow: K.sh2,
        background: dark ? "rgba(28, 28, 30, 0.72)" : "rgba(255, 255, 255, 0.72)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        border: `1px solid ${dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.5)"}`,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: K.acc, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Compass size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: K.txt, letterSpacing: -0.3 }}>NORTH</div>
            <div style={{ fontSize: 11, color: K.sub }}>Focus · Plan · Win your day</div>
          </div>
        </div>

        {/* Log in / Sign up */}
        <div role="tablist" aria-label="Log in or create an account"
          style={{ display: "flex", background: K.surf, borderRadius: 10, padding: 3, marginBottom: 18, border: `1px solid ${K.border}` }}>
          {[["login", "Log in"], ["register", "Sign up"]].map(([id, lbl]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} className="b"
              onClick={() => switchMode(id)}
              style={{
                flex: 1, textAlign: "center", padding: 8, borderRadius: 8,
                background: mode === id ? K.card : "transparent",
                color: mode === id ? K.txt : K.sub, fontSize: 13, fontWeight: 600,
                boxShadow: mode === id ? K.sh1 : "none", transition: "all .2s",
              }}>{lbl}</button>
          ))}
        </div>

        {mode === "login" ? (
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
            background: K.acc, color: "#fff", fontWeight: 600, fontSize: 14,
            opacity: busy ? 0.7 : 1, transition: "opacity .2s",
          }}>
          {busy ? "···" : mode === "login" ? "Log in" : "Create account"}
        </button>

        {/* Tell the truth about where the data goes: with a configured project
            every write is mirrored to the account and pulled back on the next
            device, so the old "stays on this device" line is no longer true. */}
        <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 10.5, color: K.muted, lineHeight: 1.5 }}>
          {supabaseConfigured
            ? "Your tasks, boards and focus history sync to your account — sign in on any NORTH client and they're there."
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

function SetPassword({ onDone, dark, onTheme }) {
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
      position: "relative", minHeight: "100vh", backgroundColor: K.bg,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: FONT,
    }}>
      {G(dark)}
      <div className="mtrl" style={{
        width: "100%", maxWidth: 400, borderRadius: 22, padding: "28px 26px", boxShadow: K.sh2,
        background: dark ? "rgba(28, 28, 30, 0.72)" : "rgba(255, 255, 255, 0.72)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        border: `1px solid ${dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.5)"}`,
      }}>
        <div style={{ position: "absolute", top: 18, right: 18 }}>
          <ThemeSwitch dark={dark} onToggle={onTheme} />
        </div>
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
            background: K.acc, color: "#fff", fontWeight: 600, fontSize: 14,
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
  const [stats, setStats] = useState({ fm: 0, done: 0, total: 0, streak: 0 });

  useEffect(() => {
    Promise.all([
      S.get(`fo:${user.un}:${today()}`),
      S.get(`u:${user.un}`),
      S.get(`lb:${user.un}`, true),
    ]).then(([fd, u, lb]) => {
      const tasks = u?.tasks || [];
      setStats({
        fm:     fd ? Math.floor(fd.s / 60) : 0,
        done:   tasks.filter((t) => t.completed && t.due === today()).length,
        total:  tasks.filter((t) => t.due === today()).length,
        streak: lb?.streak || 0,
      });
    });
  }, [user.un]);

  const h     = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const pending = (user.tasks || []).filter((t) => !t.completed && t.due === today()).slice(0, 4);

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Greeting */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: K.sub }}>{greet},</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: K.txt, marginTop: 2 }}>
          {user.name} 👋
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { I: Timer, val: `${stats.fm}m`,          lbl: "Focus"  },
          { I: Check, val: `${stats.done}/${stats.total}`, lbl: "Tasks" },
          { I: Flame, val: `${stats.streak}d`,      lbl: "Streak" },
        ].map((s) => (
          <div key={s.lbl} style={{ ...card(), textAlign: "center", padding: "16px 10px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
              <s.I size={19} strokeWidth={2} color={K.sub} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: K.txt, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: K.sub, marginTop: 3 }}>{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* Quick start */}
      <button type="button" className="b" onClick={() => go("focus")}
        aria-label="Start a focus session"
        style={{
          ...card(), marginBottom: 24, width: "100%", textAlign: "left",
          background: K.accDim,
          border: `1px solid ${K.acc}30`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: K.txt }}>Start focus session</span>
          <span style={{ fontSize: 12, color: K.sub }}>{user.pm?.w || 25} min · Pomodoro</span>
        </span>
        <span style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: K.acc, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><Play size={18} color="#fff" fill="#fff" /></span>
      </button>

      {/* Today tasks */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: K.txt }}>Today's tasks</div>
          <button type="button" className="b" onClick={() => go("tasks")}
            style={{ fontSize: 12, color: K.acc, padding: "4px 2px" }}>All →</button>
        </div>
        {pending.length === 0 ? (
          <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 13 }}>
            ✓ All clear for today
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((t) => (
              <div key={t.id} style={{ ...card2(), display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 3, height: 24, borderRadius: 2, background: PCOL()[t.pri], flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13, color: K.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity heatmap — built from recorded focus sessions */}
      <div style={{ marginTop: 26 }}>
        <ActivityMap user={user} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVITY HEATMAP
// ══════════════════════════════════════════════════════════════════════════
// GitHub-style focus map over the last 16 weeks, fed only by the recorded
// daily totals (`fo:<user>:<date>`), so every lit cell is real focused time.
const MAP_WKS = 16;
const MAP_AL  = ["1F", "45", "70", "99", "C4"]; // accent alpha steps, low → high
const HM_LVL  = (min) => min <= 0 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 50 ? 3 : min < 80 ? 4 : 5;
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
  let sum4 = 0;
  if (mins) {
    const cut = ymdOf(new Date(now.getTime() - 27 * 86400000));
    for (const [k, v] of mins) if (k >= cut) sum4 += v;
  }
  const fmtH = (min) => (min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: K.txt }}>Activity</div>
        <div style={{ fontSize: 11, color: K.sub }}>{mins ? `${fmtH(sum4)} focused · last 4 weeks` : ""}</div>
      </div>

      <div style={{ ...card(), padding: "16px 14px 12px", width: "fit-content" }}>
        {/* Month labels */}
        <div style={{ display: "flex", gap: 3, paddingLeft: 12, marginBottom: 4 }}>
          {cols.map((_, w) => (
            <div key={w} style={{ width: 13, flexShrink: 0, fontSize: 7.5, color: K.muted, lineHeight: 1, whiteSpace: "nowrap", textAlign: "left" }}>
              {monthAt(w) ? MNS[cols[w][0].d.getMonth()] : ""}
            </div>
          ))}
        </div>
        {/* Week rows (13px cells — GitHub-style, right-sized on every screen) */}
        {cols[0].map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 3, alignItems: "center", marginBottom: 3 }}>
            <div style={{ width: 9, fontSize: 7.5, color: K.muted, textAlign: "left", lineHeight: 1 }}>{HM_DOW[r]}</div>
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
                    width: 13, height: 13, borderRadius: 3.5, padding: 0, flexShrink: 0,
                    background: fut ? "transparent" : lvl === 0 ? K.border : K.acc + MAP_AL[lvl - 1],
                    boxShadow: ymd === td && !fut ? `inset 0 0 0 1.5px ${K.acc}` : "none",
                    cursor: fut ? "default" : "pointer",
                  }} />
              );
            })}
          </div>
        ))}
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 5, paddingRight: 1 }}>
          <span style={{ fontSize: 8, color: K.muted, marginRight: 3 }}>Less</span>
          {[0, 1, 2, 3, 4, 5].map((l) => (
            <span key={l} aria-hidden="true" style={{
              width: 10, height: 10, borderRadius: 2,
              background: l === 0 ? K.border : K.acc + MAP_AL[l - 1],
            }} />
          ))}
          <span style={{ fontSize: 8, color: K.muted, marginLeft: 3 }}>More</span>
        </div>
      </div>
      {mins && sum4 === 0 && (
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
const F_PMKEY = { w: 0, sb: 1, lb: 2 };   // pomodoro setting key → phase index
const F_STEP  = { w: 5, sb: 1, lb: 5 };   // stepper increments (minutes)
const F_MIN   = { w: 5, sb: 1, lb: 10 };  // clamp bounds
const F_MAX   = { w: 120, sb: 30, lb: 90 };
const F_COLS  = () => [K.acc, K.ok, K.warn];
const hm  = (ms) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;
const dur = (secs) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`);

function Focus({ user }) {
  // Local copy of the timer profile so duration edits apply instantly and
  // persist to the user record; sound/notify flags ride along in the same
  // object so they stay per-device until real account settings exist.
  const [pm, setPm] = useState({ w: 25, sb: 5, lb: 15, sound: false, notify: false, ...(user.pm || {}) });
  const DURS = [pm.w * 60, pm.sb * 60, pm.lb * 60];

  const [phase, setPhase] = useState(0);
  const [t, setT]         = useState(DURS[0]);
  const [on, setOn]       = useState(false);
  const [sess, setSess]   = useState(0);
  const [todayMin, setTodayMin] = useState(0);
  const [hist, setHist]   = useState([]); // today's persisted session records
  const [showSet, setShowSet] = useState(false); // timer settings panel

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
  const savePm = (next) => {
    setPm(next);
    S.get(`u:${user.un}`).then((u) => S.set(`u:${user.un}`, { ...(u || {}), pm: next }));
  };
  const bumpDur = (k, delta) => {
    const v = Math.min(F_MAX[k], Math.max(F_MIN[k], pm[k] + delta));
    const next = { ...pm, [k]: v };
    savePm(next);
    // If the timer is idle on the phase being edited, show the new duration
    // immediately instead of waiting for a phase switch.
    if (!on && phase === F_PMKEY[k]) { setT(v * 60); tR.current = v * 60; }
  };
  const flipPm = (k) => {
    const next = { ...pm, [k]: !pm[k] };
    savePm(next);
    // Permission must be requested from a user gesture — the toggle click.
    if (k === "notify" && next.notify && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

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
        });
        await S.set(key, recs);
        setHist(recs);
        setSess(recs.length); sR.current = recs.length;
      }
      const n    = sR.current;
      const next = n > 0 && n % 4 === 0 ? 2 : 1;
      setPhase(next); phR.current = next;
      setT(DURS[next]); tR.current = DURS[next];
    } else {
      setPhase(0); phR.current = 0;
      setT(DURS[0]); tR.current = DURS[0];
    }
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
      startR.current = Date.now();
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

  const goPhase = (i) => { setOn(false); publishFocus(null); setPhase(i); phR.current = i; setT(DURS[i]); tR.current = DURS[i]; };
  const reset   = () => { setOn(false); publishFocus(null); setT(DURS[phase]); tR.current = DURS[phase]; };
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

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: "0 0 20px" }}>Focus timer</h2>

      {/* Phase tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 30 }}>
        {F_NAMES.map((n, i) => (
          <button key={i} type="button" className="b" onClick={() => goPhase(i)}
            aria-pressed={phase === i}
            style={{ ...tag(phase === i, F_COLS()[i]), flex: 1, textAlign: "center", padding: "7px 4px" }}>{n}</button>
        ))}
      </div>

      {/* Ring */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <div style={{ position: "relative", width: 220, height: 220 }}>
          <svg width="220" height="220" viewBox="0 0 220 220" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="110" cy="110" r={R} fill="none" stroke={K.border} strokeWidth="8" />
            <circle cx="110" cy="110" r={R} fill="none" stroke={col}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - prog)}
              style={{ transition: "stroke-dashoffset .9s ease" }} />
          </svg>
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ fontSize: 48, fontWeight: 200, color: K.txt, letterSpacing: -2, fontVariantNumeric: "tabular-nums" }}>
              {mm}:{ss}
            </div>
            <div style={{ fontSize: 11, color: K.sub, marginTop: 4, letterSpacing: 1 }}>
              {F_NAMES[phase].toUpperCase()}
            </div>
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
        ].map((b) => (
          <button key={b.a11y} type="button" className="b" onClick={b.onClick} aria-label={b.a11y}
            title={b.a11y}
            style={{
              width: b.w, height: 48, borderRadius: 12,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: b.primary ? col : K.card,
              border: b.primary ? "none" : `1px solid ${K.border}`,
              color: b.primary ? "#fff" : K.sub,
              boxShadow: b.primary ? K.sh1 : "none",
            }}>
            <b.I size={b.primary ? 22 : 17} strokeWidth={2.2} color={b.primary ? "#fff" : K.sub} />
          </button>
        ))}
      </div>

      {/* Timer settings */}
      <div style={{ marginBottom: 28 }}>
        <button type="button" className="b" onClick={() => setShowSet((v) => !v)}
          aria-expanded={showSet}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", ...card(), marginBottom: showSet ? 8 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: K.txt }}>Timer settings</span>
          <span aria-hidden="true" style={{ display: "flex", transition: "transform .2s", transform: showSet ? "rotate(180deg)" : "none" }}>
            <ChevronDown size={14} color={K.muted} />
          </span>
        </button>
        {showSet && (
          <div style={{ ...card(), display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 10, color: K.sub, letterSpacing: 0.6 }}>DURATIONS · MIN</div>
            {[
              { k: "w",  lbl: "Focus" },
              { k: "sb", lbl: "Short break" },
              { k: "lb", lbl: "Long break" },
            ].map(({ k, lbl }) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: K.txt }}>{lbl}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" className="b" onClick={() => bumpDur(k, -F_STEP[k])}
                    aria-label={`Decrease ${lbl.toLowerCase()} by ${F_STEP[k]} minutes`}
                    style={{ width: 28, height: 28, borderRadius: 9, background: K.surf, border: `1px solid ${K.border}`, color: K.sub, fontSize: 17, lineHeight: 1 }}>−</button>
                  <span style={{ fontSize: 16, fontWeight: 700, color: K.txt, minWidth: 28, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{pm[k]}</span>
                  <button type="button" className="b" onClick={() => bumpDur(k, F_STEP[k])}
                    aria-label={`Increase ${lbl.toLowerCase()} by ${F_STEP[k]} minutes`}
                    style={{ width: 28, height: 28, borderRadius: 9, background: K.acc, color: "#fff", fontSize: 17, lineHeight: 1 }}>+</button>
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: K.border }} />
            <div style={{ fontSize: 10, color: K.sub, letterSpacing: 0.6 }}>WHEN A SESSION ENDS</div>
            {[
              { k: "sound", lbl: "Play a chime" },
              { k: "notify", lbl: "Send a notification" },
            ].map(({ k, lbl }) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: K.txt }}>{lbl}</span>
                <button type="button" className="b" role="switch"
                  aria-checked={pm[k]} onClick={() => flipPm(k)}
                  aria-label={`${pm[k] ? "Turn off" : "Turn on"} ${lbl.toLowerCase()}`}
                  style={{ width: 44, height: 28, borderRadius: 14, position: "relative", flexShrink: 0,
                    background: pm[k] ? K.ok : K.muted + "55", transition: "background .2s" }}>
                  <span aria-hidden="true" style={{
                    position: "absolute", top: 2, left: pm[k] ? 20 : 2, width: 24, height: 24,
                    borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                    transition: "left .18s ease",
                  }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { lbl: "TODAY'S FOCUS", val: `${todayMin}m`, col: K.acc  },
          { lbl: "SESSIONS",      val: sess,            col: K.warn },
          { lbl: "CYCLES",        val: Math.floor(sess / 4), col: K.ok },
        ].map((s) => (
          <div key={s.lbl} style={{ ...card(), textAlign: "center", padding: "14px 10px" }}>
            <div style={{ fontSize: 10, color: K.sub, marginBottom: 6, letterSpacing: 0.5 }}>{s.lbl}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: K.txt, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
          </div>
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
                <div style={{ flex: 1, fontSize: 12, color: K.txt }}>
                  {r.completed ? "Completed focus" : "Skipped focus"}
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
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════════════════════════
const T_CATS = ["Personal", "Work", "Study", "Health"];

function Tasks({ user }) {
  const [tasks,   setTasks]   = useState(user.tasks || []);
  const [filter,  setFilter]  = useState("today");
  const [showAdd, setShowAdd] = useState(false);
  const [nt,      setNt]      = useState({ title: "", due: today(), pri: "medium", cat: "Personal" });
  // Right-click actions for a task (active only when the device preference asks
  // for NORTH's menu — otherwise openMenu is a no-op and the browser menu shows).
  const { menu, openMenu, closeMenu } = useContextMenu();

  const persist = async (updated) => {
    setTasks(updated);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, tasks: updated });
    const lb = (await S.get(`lb:${user.un}`, true)) || {};
    await S.set(`lb:${user.un}`, { ...lb, tc: updated.filter((t) => t.completed).length }, true);
  };

  const add = async () => {
    if (!nt.title.trim()) return;
    await persist([...tasks, { id: uid(), ...nt, completed: false, at: Date.now() }]);
    setNt({ title: "", due: today(), pri: "medium", cat: "Personal" });
    setShowAdd(false);
  };
  const toggle = (id) => persist(tasks.map((t) => t.id === id ? { ...t, completed: !t.completed } : t));
  const del    = (id) => persist(tasks.filter((t) => t.id !== id));

  const filt = tasks.filter((t) => {
    if (filter === "today")    return t.due === today() && !t.completed;
    if (filter === "upcoming") return t.due > today()  && !t.completed;
    if (filter === "done")     return t.completed;
    return true;
  });

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: 0 }}>Tasks</h2>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            <span style={{ color: K.ok }}>{tasks.filter((t) => t.completed).length}</span>
            {" "}of {tasks.length} complete
          </div>
        </div>
        <button type="button" className="b" onClick={() => setShowAdd((v) => !v)}
          aria-label={showAdd ? "Close add task" : "Add task"}
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: showAdd ? K.card : K.acc,
            border: showAdd ? `1px solid ${K.border}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}>{showAdd ? <X size={18} color={K.sub} /> : <Plus size={18} color="#fff" />}</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ ...card(), marginBottom: 16 }}>
          <input autoFocus style={{ ...inpSt(), marginBottom: 8 }} placeholder="Task title…"
            value={nt.title} onChange={(e) => setNt((n) => ({ ...n, title: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input type="date" style={{ ...inpSt(), flex: 1, padding: "7px 10px", color: K.sub }}
              value={nt.due} onChange={(e) => setNt((n) => ({ ...n, due: e.target.value }))} />
            <select style={{ ...inpSt(), flex: 1, padding: "7px 10px", color: K.sub }}
              value={nt.pri} onChange={(e) => setNt((n) => ({ ...n, pri: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
            {T_CATS.map((c) => (
              <button key={c} type="button" className="b" onClick={() => setNt((n) => ({ ...n, cat: c }))}
                aria-pressed={nt.cat === c}
                style={{ ...tag(nt.cat === c, K.acc), padding: "5px 12px" }}>{c}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="b" onClick={() => setShowAdd(false)}
              style={{ flex: 1, padding: "8px 0", borderRadius: 8, background: K.surf, color: K.sub, fontSize: 12 }}>Cancel</button>
            <button type="button" className="b" onClick={add}
              style={{ flex: 2, padding: "8px 0", borderRadius: 8, background: K.acc, color: "#fff", fontSize: 12, fontWeight: 600 }}>Add task</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 5, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
        {[["today", "Today"], ["upcoming", "Upcoming"], ["all", "All"], ["done", "Done"]].map(([id, lbl]) => (
          <button key={id} type="button" className="b" onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            style={{ ...tag(filter === id, K.acc), padding: "5px 13px", whiteSpace: "nowrap" }}>{lbl}</button>
        ))}
      </div>

      {/* List — one grouped card, hairline rows (minimal & Apple-like) */}
      {filt.length === 0 ? (
        <div style={{ ...card(), textAlign: "center", color: K.muted, fontSize: 13, padding: "36px 16px" }}>
          {filter === "today" ? "Nothing due today — enjoy the quiet" : filter === "done" ? "No completed tasks yet" : "No tasks here"}
        </div>
      ) : (
        <div style={{ ...card(), padding: "4px 16px" }}>
          {filt.map((task, i) => {
            const due = task.due;
            let dueLbl = "";
            if (due) {
              if (due === today()) dueLbl = "Today";
              else if (due === new Date(Date.now() + 86400000).toISOString().slice(0, 10)) dueLbl = "Tomorrow";
              else if (due > today()) { const p = due.split("-"); dueLbl = `${MNS[Number(p[1]) - 1]} ${Number(p[2])}`; }
              else dueLbl = due;
            }
            return (
              <div key={task.id}
                onContextMenu={(e) => openMenu(e, [
                  { lbl: task.completed ? "Mark as not done" : "Mark as done", run: () => toggle(task.id) },
                  { lbl: "Delete task", danger: true, run: () => del(task.id) },
                ])}
                style={{
                display: "flex", alignItems: "center", gap: 11, padding: "11px 0",
                borderBottom: i < filt.length - 1 ? `1px solid ${K.border}` : "none",
                opacity: task.completed ? 0.55 : 1, transition: "opacity .2s",
              }}>
                <button type="button" className="b"
                  onClick={() => toggle(task.id)}
                  aria-label={task.completed ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
                  aria-pressed={task.completed}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${task.completed ? K.ok : K.border}`,
                    background: task.completed ? K.ok : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all .2s",
                  }}><Check size={13} strokeWidth={3.5} color={task.completed ? "#fff" : "transparent"} /></button>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span title={`Priority: ${task.pri}`} aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: PCOL()[task.pri], flexShrink: 0 }} />
                  <span style={{
                    fontSize: 14, color: task.completed ? K.muted : K.txt, fontWeight: 500,
                    textDecoration: task.completed ? "line-through" : "none",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{task.title}</span>
                </div>
                {dueLbl && (
                  <span style={{
                    fontSize: 11, flexShrink: 0, fontWeight: 600,
                    color: due === today() && !task.completed ? K.err : K.muted,
                    background: due === today() && !task.completed ? K.err + "14" : "transparent",
                    padding: "2px 7px", borderRadius: 999,
                  }}>{dueLbl}</span>
                )}
                <span style={{ fontSize: 10.5, color: K.muted, flexShrink: 0 }}>{task.cat}</span>
                <button type="button" className="b" onClick={() => del(task.id)}
                  aria-label={`Delete task "${task.title}"`}
                  style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}><X size={15} color={K.muted} /></button>
              </div>
            );
          })}
        </div>
      )}

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════════════════
const MNS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MNL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DNS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function Cal({ user }) {
  const [tasks,   setTasks]   = useState(user.tasks || []);
  const [cur,     setCur]     = useState(new Date());
  const [sel,     setSel]     = useState(() => new Date().getDate());
  const [showAdd, setShowAdd] = useState(false);
  const [newT,    setNewT]    = useState("");

  useEffect(() => {
    S.get(`u:${user.un}`).then((u) => { if (u?.tasks) setTasks(u.tasks); });
  }, [user.un]);

  const Y = cur.getFullYear(), M = cur.getMonth();
  const fd = new Date(Y, M, 1).getDay();
  const dm = new Date(Y, M + 1, 0).getDate();
  const ds  = (d) => `${Y}-${pad2(M + 1)}-${pad2(d)}`;
  const dt  = (d) => tasks.filter((t) => t.due === ds(d));
  const now = new Date();

  const addQ = async () => {
    if (!newT.trim() || !sel) return;
    const task = { id: uid(), title: newT, due: ds(sel), pri: "medium", cat: "Personal", completed: false, at: Date.now() };
    const upd  = [...tasks, task];
    setTasks(upd);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, tasks: upd });
    setNewT(""); setShowAdd(false);
  };

  const st = sel ? dt(sel) : [];

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Month header — Apple style: big title + chevrons + Today */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: K.txt, letterSpacing: -0.5 }}>
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

      <div style={{ ...card(), padding: "14px 14px 10px" }}>
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
                aria-label={`${MNL[M]} ${d}${dts.length ? ", " + dts.length + (dts.length === 1 ? " task" : " tasks") : ""}`}
                style={{
                  height: 56, borderRadius: 10, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 2,
                  background: "transparent", transition: "all .15s",
                }}>
                <span style={{
                  width: 32, height: 32, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isS ? K.acc : "transparent",
                  boxShadow: isT && !isS ? `inset 0 0 0 1.5px ${K.acc}` : "none",
                  fontSize: 14, fontWeight: isS || isT ? 700 : 500,
                  color: isS ? "#fff" : isT ? K.acc : K.txt,
                }}>{d}</span>
                <span style={{ display: "flex", gap: 2, height: 3 }}>
                  {dts.slice(0, 4).map((t, i) => (
                    <span key={i} style={{ width: 3.5, height: 3.5, borderRadius: "50%", background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
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
            <div style={{ fontSize: 17, fontWeight: 700, color: K.txt, letterSpacing: -0.3 }}>
              {MNL[M]} {sel}
              {st.length > 0 && <span style={{ color: K.sub, fontWeight: 500, marginLeft: 6, fontSize: 13 }}>{st.length} task{st.length === 1 ? "" : "s"}</span>}
            </div>
            <button type="button" className="b" onClick={() => setShowAdd((v) => !v)}
              aria-expanded={showAdd}
              style={{ ...tag(showAdd, K.acc), padding: "5px 12px", display: "flex", alignItems: "center", gap: 3 }}>
              {showAdd ? <X size={12} color={K.acc} /> : <><Plus size={12} color={K.sub} /> Add</>}
            </button>
          </div>
          {showAdd && (
            <div style={{ ...card(), display: "flex", gap: 7, marginBottom: 12, padding: "10px 12px" }}>
              <input autoFocus style={{ ...inpSt(), flex: 1, padding: "8px 12px" }} placeholder="Add task for this day…"
                value={newT} onChange={(e) => setNewT(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQ()} />
              <button type="button" className="b" onClick={addQ} aria-label="Add task for this day"
                style={{ padding: "9px 15px", borderRadius: 8, background: K.acc, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} color="#fff" /></button>
            </div>
          )}
          <div style={{ ...card(), padding: "4px 14px" }}>
            {st.length === 0 ? (
              <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: "16px 0" }}>Nothing planned for this day</div>
            ) : st.map((t, i) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                borderBottom: i < st.length - 1 ? `1px solid ${K.border}` : "none",
              }}>
                <div style={{ width: 3, height: 20, borderRadius: 2, flexShrink: 0, background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
                <div style={{ flex: 1, fontSize: 13.5, color: t.completed ? K.muted : K.txt, textDecoration: t.completed ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                <div style={{ fontSize: 11, color: K.muted, flexShrink: 0 }}>{t.cat}</div>
              </div>
            ))}
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
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: 0 }}>Screen time</h2>
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
              style={{ flex: 2, padding: "8px 0", borderRadius: 8, background: K.acc, color: "#fff", fontSize: 12, fontWeight: 600 }}>Track app</button>
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

const ENFORCEMENT_ROWS = [
  { kind: "websites", cap: "extension", client: "Browser extension" },
  { kind: "applications", cap: "desktop", client: "Desktop app" },
];

function Blocking({ user }) {
  const [blocking, setBlocking] = useState(() => normalizeState(user.blocking || defaultBlocking()));
  const [, bumpClock] = useState(0); // the verdict depends on the wall clock
  const [showSite, setShowSite] = useState(false);
  const [site, setSite] = useState("");
  const [showAppRule, setShowAppRule] = useState(false);
  const [appName, setAppName] = useState("");
  const [showSched, setShowSched] = useState(false);
  const [draft, setDraft] = useState(() => newSchedule({ name: "Work hours" }));
  const [err, setErr] = useState("");
  // Right-click actions for a block rule (no-op unless the device preference
  // asks for NORTH's menu).
  const { menu, openMenu, closeMenu } = useContextMenu();

  // A schedule can start, or a focus session end, while this screen is open —
  // so refresh the status instead of showing a stale verdict.
  useEffect(() => {
    const id = setInterval(() => bumpClock((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const verdict = evaluateBlocking(blocking, now);
  const status = describeBlocking(blocking, now);
  const grouped = rulesByKind(blocking);
  const tracked = user.apps || [];

  const persist = async (next) => {
    setBlocking(next);
    const u = (await S.get(PROFILE_KEY(user.un))) || {};
    await S.set(PROFILE_KEY(user.un), { ...u, blocking: next });
  };
  const patchRule = async (rule) => persist(upsertRule(blocking, rule));

  const addWebsite = async () => {
    const host = normalizeHost(site);
    if (!host) { setErr("That doesn't look like a domain — try youtube.com"); return; }
    if (blocking.rules.some((r) => r.kind === "website" && r.target === host)) {
      setErr(`${host} is already on the list.`); return;
    }
    await persist(upsertRule(blocking, newRule({ kind: "website", target: host })));
    setSite(""); setShowSite(false); setErr("");
  };

  const addAppRule = async () => {
    const name = normalizeApp(appName);
    if (!name) { setErr("Name the application — e.g. Steam"); return; }
    if (blocking.rules.some((r) => r.kind === "app" && r.target.toLowerCase() === name.toLowerCase())) {
      setErr(`${name} is already on the list.`); return;
    }
    await persist(upsertRule(blocking, newRule({ kind: "app", target: name })));
    setAppName(""); setShowAppRule(false); setErr("");
  };

  const addSchedule = async () => {
    if (!draft.days.length) { setErr("Pick at least one day for the schedule."); return; }
    if (draft.start === draft.end) { setErr("A schedule needs a start and an end that differ."); return; }
    await persist(upsertSchedule(blocking, draft));
    setDraft(newSchedule({ name: "Work hours" })); setShowSched(false); setErr("");
  };

  /** The Always / During focus / Scheduled chips on every rule. */
  const WhenPicker = ({ rule }) => (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      {["always", "focus", "scheduled"].map((w) => (
        <button key={w} type="button" className="b" onClick={() => patchRule({ ...rule, when: w })}
          aria-pressed={rule.when === w}
          style={{ ...tag(rule.when === w, K.acc), padding: "3px 9px", fontSize: 10.5 }}>
          {RULE_WHEN_LABEL[w]}
        </button>
      ))}
      {rule.when === "scheduled" && (
        blocking.schedules.length === 0 ? (
          <span style={{ fontSize: 10.5, color: K.warn }}>Add a schedule below</span>
        ) : (
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {blocking.schedules.map((sc) => {
              const on = rule.scheduleIds.includes(sc.id);
              return (
                <button key={sc.id} type="button" className="b"
                  onClick={() => patchRule({
                    ...rule,
                    scheduleIds: on ? rule.scheduleIds.filter((x) => x !== sc.id) : [...rule.scheduleIds, sc.id],
                  })}
                  aria-pressed={on}
                  style={{ ...tag(on, K.ok), padding: "3px 9px", fontSize: 10.5 }}>{sc.name}</button>
              );
            })}
          </span>
        )
      )}
    </div>
  );

  const RuleRow = ({ rule }) => {
    const why = verdict.reasons[rule.id];
    const paused = why?.reason === "temp-unblock";
    const blockedNow = Boolean(why) && !paused;
    const usage = rule.kind === "app"
      ? tracked.find((a) => String(a.name).toLowerCase() === rule.target.toLowerCase())
      : null;
    return (
      <div style={{ ...card2(), marginBottom: 8 }}
        onContextMenu={(e) => openMenu(e, [
          ...(blockedNow && blocking.settings.allowTemporaryUnblock
            ? [{
                lbl: `Pause for ${blocking.settings.tempUnblockMinutes}m`,
                run: () => persist(unblockUntil(blocking, rule.id, blocking.settings.tempUnblockMinutes)),
              }]
            : []),
          {
            lbl: rule.enabled ? "Turn rule off" : "Turn rule on",
            run: () => persist(setRuleEnabled(blocking, rule.id, !rule.enabled)),
          },
          { lbl: "Remove rule", danger: true, run: () => persist(removeRule(blocking, rule.id)) },
        ])}>
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
              Pause {blocking.settings.tempUnblockMinutes}m
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
        <WhenPicker rule={rule} />
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
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>Blocking</h2>

      {/* ── Status: what is blocked right now, and why ── */}
      <div style={{
        ...card(), marginBottom: 14,
        background: status.active ? K.err + "12" : K.card,
        border: `1px solid ${status.active ? K.err + "40" : K.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0, fontSize: 18,
            background: status.active ? K.err + "22" : K.accDim,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{status.active ? "🛡" : "🕊"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: K.txt }}>{status.headline}</div>
            <div style={{ fontSize: 11.5, color: K.sub, marginTop: 2 }}>{status.detail}</div>
            {verdict.focus.active && (
              <div style={{ fontSize: 11, color: K.acc, marginTop: 4 }}>
                Focus session · {verdict.focus.minutesLeft}m left
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Configured here vs enforced elsewhere (from the shared table) ── */}
      <div style={{ ...card(), marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.6, color: K.sub, marginBottom: 9 }}>WHERE THIS IS ENFORCED</div>
        {ENFORCEMENT_ROWS.map(({ kind, cap, client }) => {
          const c = CLIENT_CAPABILITIES[cap];
          const on = kind === "websites" ? verdict.websites.length : verdict.apps.length;
          return (
            <div key={kind} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
              <span aria-hidden="true" style={{ fontSize: 13 }}>{c.enforceWebsites || c.enforceApps ? "✅" : "—"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: K.txt }}>
                  {kind === "websites" ? "Websites" : "Applications"} → {client}
                  {on > 0 && <span style={{ color: K.err }}> · {on} active now</span>}
                </div>
                <div style={{ fontSize: 10.5, color: K.sub, lineHeight: 1.5, marginTop: 1 }}>{c.note}</div>
              </div>
            </div>
          );
        })}
        <div style={{ height: 1, background: K.border, margin: "2px 0 10px" }} />
        <div style={{ fontSize: 10.5, color: K.sub, lineHeight: 1.6 }}>
          This page stores your rules in your account and shows what they do. It cannot
          block a browser or an OS application itself — sign in to the NORTH extension
          and desktop app with the same account so they can enforce these rules.
          {" "}On mobile, iOS and Android only permit app limits through an OS-granted
          entitlement, which NORTH does not ship yet.
        </div>
      </div>

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
        <div style={{ ...card(), marginBottom: 12, display: "flex", gap: 7 }}>
          <input autoFocus style={{ ...inpSt(), flex: 1 }} placeholder="youtube.com"
            value={site} onChange={(e) => setSite(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addWebsite(); }} />
          <button type="button" className="b" onClick={addWebsite}
            style={{ padding: "9px 16px", borderRadius: 10, background: K.acc, color: "#fff", fontSize: 12.5, fontWeight: 600 }}>Add</button>
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
        <div style={{ ...card(), marginBottom: 12, display: "flex", gap: 7 }}>
          <input autoFocus style={{ ...inpSt(), flex: 1 }} placeholder="Application name (e.g. Steam)"
            value={appName} onChange={(e) => setAppName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addAppRule(); }} />
          <button type="button" className="b" onClick={addAppRule}
            style={{ padding: "9px 16px", borderRadius: 10, background: K.acc, color: "#fff", fontSize: 12.5, fontWeight: 600 }}>Add</button>
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
              style={{ flex: 2, padding: "8px 0", borderRadius: 8, background: K.acc, color: "#fff", fontSize: 12, fontWeight: 600 }}>Add schedule</button>
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
      <div style={{ height: 40 }} aria-hidden="true" />

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
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
  const [fi,      setFi]      = useState("");
  const [ferr,    setFerr]    = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    S.list("lb:", true).then(async (keys) => {
      const entries = (await Promise.all(
        keys.map((k) => S.get(k, true).then((d) => (d ? { un: k.slice(3), ...d } : null)))
      )).filter(Boolean);
      entries.sort((a, b) => (b.fm || 0) - (a.fm || 0));
      setBoard(entries);
      setLoading(false);
    });
  }, []);

  const myRank = board.findIndex((e) => e.un === user.un) + 1;
  const myData = board.find((e) => e.un === user.un);
  const fBoard = board.filter((e) => friends.includes(e.un));
  const others = board.filter((e) => e.un !== user.un);

  const doAdd = async () => {
    const un = fi.toLowerCase().trim();
    if (!un) return;
    if (un === user.un)        return setFerr("Can't add yourself.");
    if (friends.includes(un)) return setFerr("Already friends.");
    // A username is public on the leaderboard but nothing else is: an account
    // row is only readable by its owner (profiles_self in the schema), so the
    // leaderboard is what tells us the account exists — which is also the only
    // thing we need, since friendships are stored as usernames.
    const keys = await S.list("lb:", true);
    if (!keys.includes(`lb:${un}`)) {
      return setFerr("No NORTH account with that username yet.");
    }
    const nf = [...friends, un];
    setFriends(nf); setFi(""); setFerr("");
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, friends: nf });
  };

  const rmFriend = async (un) => {
    const nf = friends.filter((f) => f !== un);
    setFriends(nf);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, friends: nf });
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
        color: "#fff", fontSize: 12, fontWeight: 700,
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
        <div style={{ fontSize: 15, fontWeight: 700, color: K.acc }}>{e.fm || 0}m</div>
        <div style={{ fontSize: 9, color: K.muted }}>focus</div>
      </div>
      {rm && <button type="button" className="b" onClick={() => rmFriend(e.un)}
        aria-label={`Remove ${e.name || e.un} from friends`}
        style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}><X size={15} color={K.muted} /></button>}
    </div>
  );

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>Social</h2>

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
        {[["board", "Leaderboard"], ["friends", "Friends"]].map(([id, lbl]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="b"
            onClick={() => setTab(id)}
            style={{
              flex: 1, textAlign: "center", padding: 7, borderRadius: 8,
              background: tab === id ? K.accDim : "transparent",
              color: tab === id ? K.acc : K.sub, fontSize: 12, fontWeight: 600, transition: "all .2s",
            }}>{lbl}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: K.muted, padding: 40 }}>Loading…</div>
      ) : tab === "board" ? (
        others.length === 0 ? (
          <div style={{ ...card(), textAlign: "center", padding: "34px 18px" }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, background: K.accDim, margin: "0 auto 12px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><Users size={24} color={K.acc} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: K.txt }}>Your leaderboard is fresh</div>
            <div style={{ fontSize: 12, color: K.sub, marginTop: 6, lineHeight: 1.6, maxWidth: 330, marginLeft: "auto", marginRight: "auto" }}>
              You're the first one here. Rankings are live and server-computed —
              they fill up as more people join NORTH on any client.
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
              style={{ padding: "10px 18px", borderRadius: 10, background: K.acc, color: "#fff", fontSize: 13, fontWeight: 600 }}>
              Add
            </button>
          </div>
          {ferr && <div style={{ color: K.err, fontSize: 12, marginBottom: 10 }}>{ferr}</div>}
          {friends.length === 0 ? (
            <div style={{ ...card(), textAlign: "center", padding: "30px 16px" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>👋</div>
              <div style={{ fontSize: 13, color: K.txt, fontWeight: 600 }}>No friends yet</div>
              <div style={{ fontSize: 11.5, color: K.sub, marginTop: 5, lineHeight: 1.6, maxWidth: 300, marginLeft: "auto", marginRight: "auto" }}>
                Add anyone on the leaderboard by their username, from any device.
              </div>
            </div>
          ) : fBoard.length === 0 ? (
            <div style={{ textAlign: "center", color: K.muted, fontSize: 12, padding: 20 }}>Friends haven't used the app yet</div>
          ) : (
            fBoard.map((e) => {
              const rank = board.findIndex((b) => b.un === e.un) + 1;
              return <Row key={e.un} e={e} rank={rank} rm />;
            })
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BOARDS / KANBAN
// ══════════════════════════════════════════════════════════════════════════
const B_COLS = ["todo", "doing", "done"];
const B_COL_NAMES = { todo: "To do", doing: "Doing", done: "Done" };

function Boards({ user }) {
  const [boards, setBoards] = useState([]);            // [{ id, name, cols: [{id,name}] }]
  const [tasks,  setTasks]  = useState(user.tasks || []);
  const [sel,    setSel]    = useState(null);           // selected board id
  const [newB,   setNewB]   = useState("");             // new-board name draft
  const [ren,    setRen]    = useState("");             // rename draft
  const [renId,  setRenId]  = useState(null);           // board being renamed
  const [addT,   setAddT]   = useState({});             // colId → draft card title

  useEffect(() => {
    Promise.all([S.get(`bd:${user.un}`), S.get(`u:${user.un}`)]).then(([bd, u]) => {
      const list = bd || [];
      setBoards(list);
      if (list.length) setSel((s) => (s && list.some((b) => b.id === s) ? s : list[0].id));
      if (u?.tasks) setTasks(u.tasks);
    });
  }, [user.un]);

  // Cards ARE tasks: one list, many views (Tasks / Calendar / Boards share it).
  const persistTasks = async (upd) => {
    setTasks(upd);
    const u = (await S.get(`u:${user.un}`)) || {};
    await S.set(`u:${user.un}`, { ...u, tasks: upd });
    const lb = (await S.get(`lb:${user.un}`, true)) || {};
    await S.set(`lb:${user.un}`, { ...lb, tc: upd.filter((t) => t.completed).length }, true);
  };
  const persistBoards = async (upd) => { setBoards(upd); await S.set(`bd:${user.un}`, upd); };

  const addBoard = async () => {
    if (!newB.trim()) return;
    const b = { id: uid(), name: newB.trim(), cols: B_COLS.map((c) => ({ id: c, name: B_COL_NAMES[c] })) };
    const upd = [...boards, b];
    await persistBoards(upd);
    setSel(b.id); setNewB("");
  };
  const renameBoard = async () => {
    if (!ren.trim()) return setRenId(null);
    await persistBoards(boards.map((b) => (b.id === renId ? { ...b, name: ren.trim() } : b)));
    setRenId(null);
  };
  const delBoard = async (id) => {
    const upd = boards.filter((b) => b.id !== id);
    await persistBoards(upd);
    // Cards survive: they return to plain tasks (visible in Tasks/Calendar).
    await persistTasks(tasks.map((t) => (t.boardId === id ? { ...t, boardId: undefined, colId: undefined } : t)));
    setSel(upd.length ? upd[0].id : null);
  };

  const addCard = async (colId) => {
    const d = addT[colId];
    if (!d || !d.trim()) return;
    const task = {
      id: uid(), title: d.trim(), due: "", pri: "medium", cat: "Personal",
      completed: false, at: Date.now(), boardId: sel, colId,
    };
    await persistTasks([...tasks, task]);
    setAddT((a) => ({ ...a, [colId]: "" }));
  };
  const move = async (id, dir) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const i = B_COLS.indexOf(t.colId);
    const j = Math.min(B_COLS.length - 1, Math.max(0, i + dir));
    if (j === i) return;
    await persistTasks(tasks.map((x) => (x.id === id ? { ...x, colId: B_COLS[j] } : x)));
  };
  const dropTo = async (id, colId) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.colId === colId) return;
    await persistTasks(tasks.map((x) => (x.id === id ? { ...x, colId } : x)));
  };
  const toggle = (id) => persistTasks(tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  const delCard = (id) => persistTasks(tasks.filter((t) => t.id !== id));

  const board = boards.find((b) => b.id === sel) || null;
  const bTasks = board ? tasks.filter((t) => t.boardId === board.id) : [];

  return (
    <div style={{ padding: "24px 20px 8px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: 0 }}>Boards</h2>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 2 }}>
            {boards.length ? `${boards.length} board${boards.length === 1 ? "" : "s"} · cards sync with Tasks` : "Kanban for your projects"}
          </div>
        </div>
        <button type="button" className="b" onClick={() => setNewB((v) => (v === "" ? " " : ""))}
          aria-expanded={newB !== ""}
          aria-label={newB !== "" ? "Close new board" : "New board"}
          style={{
            width: 32, height: 32, borderRadius: 8, background: newB !== "" ? K.card : K.acc,
            border: newB !== "" ? `1px solid ${K.border}` : "none",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{newB !== "" ? <X size={18} color={K.sub} /> : <Plus size={18} color="#fff" />}</button>
      </div>

      {/* New board inline form */}
      {newB !== "" && (
        <div style={{ ...card(), marginBottom: 14, display: "flex", gap: 7 }}>
          <input autoFocus style={{ ...inpSt(), flex: 1, padding: "8px 12px" }}
            placeholder="Board name (e.g. Product Launch)"
            value={newB === " " ? "" : newB} onChange={(e) => setNewB(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addBoard(); if (e.key === "Escape") setNewB(""); }} />
          <button type="button" className="b" onClick={addBoard} aria-label="Create board"
            style={{ padding: "8px 16px", borderRadius: 8, background: K.acc, color: "#fff", fontSize: 13, fontWeight: 600 }}>Create</button>
        </div>
      )}

      {/* Board chips + rename/delete */}
      {boards.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {boards.map((b) => (
              <button key={b.id} type="button" className="b" onClick={() => setSel(b.id)}
                aria-pressed={sel === b.id}
                style={{ ...tag(sel === b.id, K.acc), padding: "6px 14px", whiteSpace: "nowrap" }}>{b.name}</button>
            ))}
          </div>
          {board && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
              {renId === board.id ? (
                <>
                  <input autoFocus style={{ ...inpSt(), flex: 1, padding: "6px 10px", fontSize: 12 }}
                    value={ren} onChange={(e) => setRen(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") renameBoard(); if (e.key === "Escape") setRenId(null); }} />
                  <button type="button" className="b" onClick={renameBoard}
                    style={{ padding: "7px 12px", borderRadius: 8, background: K.acc, color: "#fff", fontSize: 12 }}>Save</button>
                  <button type="button" className="b" onClick={() => setRenId(null)}
                    style={{ padding: "7px 10px", borderRadius: 8, background: K.surf, color: K.sub, fontSize: 12 }}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="b"
                    onClick={() => { setRen(board.name); setRenId(board.id); }}
                    style={{ fontSize: 11, color: K.sub, padding: "4px 2px", display: "flex", alignItems: "center", gap: 4 }}>
                    <PenLine size={12} color={K.sub} /> Rename
                  </button>
                  <span style={{ color: K.border, fontSize: 11 }}>·</span>
                  <button type="button" className="b" onClick={() => delBoard(board.id)}
                    style={{ fontSize: 11, color: K.err, padding: "4px 2px", display: "flex", alignItems: "center", gap: 4 }}>
                    <Trash2 size={12} color={K.err} /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Columns */}
      {!board ? (
        <div style={{ ...card(), textAlign: "center", padding: "44px 16px" }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>🗂</div>
          <div style={{ fontSize: 13, color: K.txt, fontWeight: 600 }}>No boards yet</div>
          <div style={{ fontSize: 11, color: K.sub, marginTop: 4 }}>Create one and drag tasks into To do / Doing / Done</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", alignItems: "flex-start", paddingBottom: 6, margin: "0 -20px", paddingLeft: 20, paddingRight: 20 }}>
          {board.cols.map((c) => {
            const cards = bTasks.filter((t) => t.colId === c.id);
            const ci = B_COLS.indexOf(c.id);
            return (
              <div key={c.id} style={{ width: 232, flexShrink: 0 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) dropTo(id, c.id); }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: K.txt, letterSpacing: 0.3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: c.id === "todo" ? K.sub : c.id === "doing" ? K.warn : K.ok }} />
                    {c.name}
                    <span style={{ color: K.muted, fontWeight: 400 }}>{cards.length}</span>
                  </div>
                  <button type="button" className="b" onClick={() => setAddT((a) => ({ ...a, [c.id]: a[c.id] === undefined ? " " : undefined }))}
                    aria-expanded={addT[c.id] !== undefined}
                    aria-label={`Add a card to ${c.name}`}
                    style={{ width: 24, height: 24, borderRadius: 7, background: K.surf, border: `1px solid ${K.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {addT[c.id] !== undefined ? <X size={13} color={K.sub} /> : <Plus size={13} color={K.sub} />}
                  </button>
                </div>

                {addT[c.id] !== undefined && (
                  <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                    <input autoFocus style={{ ...inpSt(), flex: 1, padding: "7px 10px", fontSize: 12 }}
                      placeholder="Card title…"
                      value={addT[c.id] === " " ? "" : addT[c.id] || ""}
                      onChange={(e) => setAddT((a) => ({ ...a, [c.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") addCard(c.id); if (e.key === "Escape") setAddT((a) => ({ ...a, [c.id]: undefined })); }} />
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 40 }}>
                  {cards.length === 0 && (
                    <div style={{ fontSize: 11, color: K.muted, textAlign: "center", padding: "14px 0" }}>No cards</div>
                  )}
                  {cards.map((t) => (
                    <div key={t.id} draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      style={{ ...card2(), opacity: t.completed ? 0.55 : 1, cursor: "grab" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ width: 3, height: 26, borderRadius: 2, flexShrink: 0, background: PCOL()[t.pri], marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: t.completed ? K.muted : K.txt, textDecoration: t.completed ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                          <div style={{ fontSize: 10, color: K.muted, marginTop: 3, textTransform: "capitalize" }}>{t.pri}{t.due ? ` · ${t.due}` : ""}</div>
                        </div>
                        <button type="button" className="b" onClick={() => toggle(t.id)}
                          aria-label={t.completed ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                          aria-pressed={t.completed}
                          style={{
                            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                            border: `2px solid ${t.completed ? K.ok : K.border}`,
                            background: t.completed ? K.ok + "22" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}><Check size={11} strokeWidth={3.5} color={t.completed ? K.ok : "transparent"} /></button>
                      </div>
                      <div style={{ display: "flex", gap: 5, marginTop: 9, alignItems: "center" }}>
                        <button type="button" className="b" onClick={() => move(t.id, -1)}
                          disabled={ci === 0}
                          aria-label={`Move "${t.title}" to previous column`}
                          style={{ flex: 1, padding: "4px 0", borderRadius: 7, background: K.surf, border: `1px solid ${K.border}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: ci === 0 ? 0.35 : 1 }}>
                          <ChevronLeft size={13} color={K.sub} />
                        </button>
                        <button type="button" className="b" onClick={() => move(t.id, 1)}
                          disabled={ci === B_COLS.length - 1}
                          aria-label={`Move "${t.title}" to next column`}
                          style={{ flex: 1, padding: "4px 0", borderRadius: 7, background: K.surf, border: `1px solid ${K.border}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: ci === B_COLS.length - 1 ? 0.35 : 1 }}>
                          <ChevronRight size={13} color={K.sub} />
                        </button>
                        <button type="button" className="b" onClick={() => delCard(t.id)}
                          aria-label={`Delete card "${t.title}"`}
                          style={{ padding: "4px 7px", borderRadius: 7, color: K.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <X size={13} color={K.muted} />
                        </button>
                      </div>
                    </div>
                  ))}
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
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,  setUser]  = useState(null);
  const [tab,   setTab]   = useState("home");
  const [boot,  setBoot]  = useState(true);
  const [scrl,  setScrl]  = useState(false); // content overlapping the sticky header?
  // Default theme is LIGHT; the header switch flips it and the choice is
  // remembered on this device only (never synced account data).
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem("fl_th");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch {}
    return false; // default: light
  });
  K = dark ? D : L; // activate palette for this render pass

  // Right-click policy — also device-local, initialised from storage and
  // activated for this render pass the same way the palette is.
  const [ctx, setCtx] = useState(readCtxPreference);
  CTX = ctxMode(ctx);

  useEffect(() => {
    try { localStorage.setItem("fl_th", dark ? "1" : "0"); } catch {}
  }, [dark]);

  useEffect(() => {
    try { localStorage.setItem("fl_ctx", ctxMode(ctx)); } catch {}
  }, [ctx]);

  // A password-reset link signs the person in with a PASSWORD_RECOVERY session.
  // Catch that event and route to the set-a-new-password screen instead of
  // silently dropping them into the app.
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => { try { data?.subscription?.unsubscribe(); } catch { /* already gone */ } };
  }, []);

  const toggleTheme = () => setDark((d) => !d);

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
   */
  const adoptAccount = async (accountUser) => {
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
    await S.set(SESSION_KEY, { un: mapped.un });

    // Link this device to the account and adopt the account's copy of the data.
    // `bootstrap` pushes what this device already holds *before* pulling, so a
    // record made before signing in is never discarded by the first sync.
    SYNC.attach({ userId: accountUser?.id, un: mapped.un });
    if (accountUser?.id) {
      await SYNC.bootstrap(mapped.un).catch(() => {});
      const fromAccount = await loadProfile(mapped.un);
      if (fromAccount) return toAppUser(accountUser, fromAccount);
    }
    return mapped;
  };

  const login = async (accountUser) => setUser(await adoptAccount(accountUser));

  const logout = async () => {
    // Sign out of the account service too — otherwise the Supabase session
    // survives and the person is silently signed back in on reload.
    try { if (supabaseConfigured && supabase) await supabase.auth.signOut(); } catch {}
    await S.del(SESSION_KEY);
    SYNC.detach();
    setUser(null);
    setTab("home");
  };

  // Boot: the device record first (so the app works offline and with no account
  // service configured), then Supabase's own session, which wins over it.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const sess = await S.get(SESSION_KEY);
        if (sess?.un) {
          const u = await loadProfile(sess.un);
          if (u && !dead) setUser(u);
        }
        if (supabaseConfigured && supabase) {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user && !dead) setUser(await adoptAccount(data.session.user));
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
    loadProfile(user.un).then((u) => {
      if (u) setUser((p) => (p && p.un === user.un ? u : p));
    });
  };
  const TABS = [
    { id: "home",     I: HomeIcon,   lbl: "Home"   },
    { id: "focus",    I: Timer,      lbl: "Focus"  },
    { id: "tasks",    I: ListChecks, lbl: "Tasks"  },
    { id: "boards",   I: LayoutGrid, lbl: "Boards" },
    { id: "calendar", I: Calendar,   lbl: "Cal"    },
    { id: "block",    I: Shield,     lbl: "Block"  },
    { id: "social",   I: Users,      lbl: "Social" },
  ];

  const pages = user ? {
    home:     <Home     user={user} go={goTab} />,
    focus:    <Focus    user={user} />,
    tasks:    <Tasks    user={user} />,
    boards:   <Boards   user={user} />,
    calendar: <Cal      user={user} />,
    block:    <Blocking user={user} />,
    social:   <Social   user={user} />,
  } : {};

  /* ── LOADING ── */
  if (boot) return (
    <>
      {G(dark)}
      <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Compass size={36} color={K.acc} />
      </div>
    </>
  );

  /* ── AUTH ── */
  if (!user) return <Auth onLogin={login} dark={dark} onTheme={toggleTheme} />;

  /* ── PASSWORD RESET (arrived from the reset email) ── */
  if (recovery) {
    return <SetPassword onDone={() => setRecovery(false)} dark={dark} onTheme={toggleTheme} />;
  }

  /* ── APP SHELL (website layout: top bar + nav row, no phone frame) ── */
  return (
    <div style={{ minHeight: "100vh", background: K.bg, fontFamily: FONT }}>
      {G(dark)}
      <header className="mtrl" style={{
        position: "sticky", top: 0, zIndex: 20,
        background: dark ? "rgba(16, 16, 18, 0.72)" : "rgba(249, 249, 251, 0.78)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        boxShadow: scrl ? (dark ? "0 1px 0 rgba(255,255,255,.06)" : "0 1px 0 rgba(0,0,0,.07)") : "none",
        transition: "box-shadow .25s ease",
      }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "10px 20px 0", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {/* Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: K.acc, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Compass size={16} color="#fff" />
              </div>
              <span style={{ fontSize: 16, fontWeight: 800, color: K.txt, letterSpacing: -0.3 }}>NORTH</span>
            </div>
            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ThemeSwitch dark={dark} onToggle={toggleTheme} />
              <Preferences ctx={ctxMode(ctx)} onCtx={setCtx} />
              <div
                title={displayName(user)}
                aria-label={`Signed in as ${displayName(user)}`}
                style={{
                  width: 28, height: 28, borderRadius: 8, background: K.acc,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 12, fontWeight: 800,
                }}>{initial(user)}</div>
              <button type="button" className="b" onClick={logout}
                style={{ fontSize: 12, color: K.sub, padding: "4px 2px" }}>Sign out</button>
            </div>
          </div>
          {/* Nav row */}
          <nav aria-label="Main" style={{ display: "flex", gap: 2, overflowX: "auto", padding: "6px 0 10px" }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" className="b nv" onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                  padding: "6px 12px", borderRadius: 9,
                  background: tab === t.id ? K.accDim : "transparent",
                  color: tab === t.id ? K.acc : K.sub,
                  fontWeight: tab === t.id ? 700 : 500,
                  fontSize: 12.5, transition: "background-color .15s ease",
                }}>
                <t.I aria-hidden="true" size={15} strokeWidth={2.2} color={tab === t.id ? K.acc : K.muted} />
                {t.lbl}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ─ Content ─ */}
      <main key={tab} className="pge" style={{ width: "100%", maxWidth: 1120, margin: "0 auto", boxSizing: "border-box" }}>
        {pages[tab]}
        <div style={{ height: 60 }} aria-hidden="true" />
      </main>
    </div>
  );
}
