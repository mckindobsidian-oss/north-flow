import { useState, useEffect, useRef } from "react";
import {
  Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Flame,
  Home as HomeIcon, LayoutGrid, ListChecks, Pause, PenLine, Play, Plus,
  RotateCcw, Shield, SkipForward, Timer, Trash2, Users, X, Zap,
} from "lucide-react";

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
const S = {
  async get(key, shared = false) {
    try { const r = await pick().get(key, shared); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(key, val, shared = false) {
    try { await pick().set(key, JSON.stringify(val), shared); } catch {}
  },
  async del(key, shared = false) {
    try { await pick().delete(key, shared); } catch {}
  },
  async list(prefix, shared = false) {
    try { const r = await pick().list(prefix, shared); return r?.keys || []; }
    catch { return []; }
  },
};

// ── HELPERS ──────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
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

// Small injected stylesheet (hover/press/focus need real CSS, inline styles
// can't do :hover). Rendered with the active palette by every top-level view.
const G = (dark) => (
  <style>{`
    :root { color-scheme: ${dark ? "dark" : "light"}; }
    body { background: ${K.bg}; font-family: ${FONT}; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    button, input, select, textarea { font-family: inherit; }
    .b { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
         cursor: pointer; text-align: center; line-height: inherit; transition: transform .12s ease;
         -webkit-tap-highlight-color: transparent; }
    .b:active { transform: scale(.96); }
    .b:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid ${K.acc}; outline-offset: 2px; border-radius: 6px; }
    ::selection { background: ${K.acc}30; }
  `}</style>
);

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
function Auth({ onLogin, dark }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ user: "", pass: "", name: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    if (!f.user || !f.pass || (mode === "register" && !f.name))
      return setErr("Fill all fields.");
    setBusy(true); setErr("");
    const un  = f.user.toLowerCase().trim();
    const key = `u:${un}`;
    const ex  = await S.get(key);

    if (mode === "login") {
      if (!ex)            { setErr("User not found."); return setBusy(false); }
      if (ex.pw !== f.pass) { setErr("Wrong password."); return setBusy(false); }
      onLogin({ un, ...ex });
    } else {
      if (ex) { setErr("Username taken."); return setBusy(false); }
      const data = { pw: f.pass, name: f.name.trim(), tasks: [], apps: [], friends: [], pm: { w: 25, sb: 5, lb: 15 } };
      await S.set(key, data);
      await S.set(`lb:${un}`, { name: f.name.trim(), fm: 0, tc: 0, streak: 0, last: today() }, true);
      onLogin({ un, ...data });
    }
    setBusy(false);
  };

  const Row = ({ ph, k, t = "text" }) => (
    <input type={t} placeholder={ph} value={f[k]} onChange={set(k)}
      onKeyDown={(e) => e.key === "Enter" && submit()}
      style={inpSt()} />
  );

  return (
    <div style={{
      position: "relative", minHeight: "100vh", background: K.bg, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: FONT,
    }}>
      {G(dark)}
      <div style={{ width: "100%", maxWidth: 340 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16,
            background: K.acc,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}><Zap size={26} color="#fff" fill="#fff" /></div>
          <div style={{ fontSize: 22, fontWeight: 700, color: K.txt, letterSpacing: -0.3 }}>Focusly</div>
          <div style={{ fontSize: 12, color: K.sub, marginTop: 4 }}>
            Minimal productivity · Maximum focus
          </div>
        </div>

        {/* Mode toggle */}
        <div role="tablist" aria-label="Choose sign in or register"
          style={{ display: "flex", background: K.surf, borderRadius: 10, padding: 3, marginBottom: 18, border: `1px solid ${K.border}` }}>
          {["login", "register"].map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className="b"
              onClick={() => { setMode(m); setErr(""); }}
              style={{
                flex: 1, textAlign: "center", padding: 7, borderRadius: 8,
                background: mode === m ? K.accDim : "transparent",
                color: mode === m ? K.acc : K.sub, fontSize: 13, fontWeight: 600,
                textTransform: "capitalize", transition: "all .2s",
              }}>{m}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {mode === "register" && <Row ph="Display name" k="name" />}
          <Row ph="Username" k="user" />
          <Row ph="Password" k="pass" t="password" />
        </div>

        {err && <div role="alert" style={{ color: K.err, fontSize: 12, marginTop: 8, textAlign: "center" }}>{err}</div>}

        <button type="button" className="b" onClick={submit} disabled={busy}
          style={{
            marginTop: 16, padding: 13, borderRadius: 10, width: "100%",
            background: K.acc,
            color: "#fff", fontWeight: 600, fontSize: 14,
            opacity: busy ? 0.7 : 1, transition: "opacity .2s",
          }}>
          {busy ? "···" : mode === "login" ? "Sign in" : "Create account"}
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
    <div style={{ padding: "20px 16px" }}>
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

      <div style={{ ...card(), padding: "14px 12px 10px" }}>
        {/* Month labels */}
        <div style={{ display: "flex", gap: 3, paddingLeft: 13, marginBottom: 4 }}>
          {cols.map((_, w) => (
            <div key={w} style={{ flex: 1, fontSize: 8, color: K.muted, height: 10, overflow: "hidden", whiteSpace: "nowrap", textAlign: "center" }}>
              {monthAt(w) ? MNS[cols[w][0].d.getMonth()] : ""}
            </div>
          ))}
        </div>
        {/* Week rows */}
        {cols[0].map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 3, alignItems: "center", marginBottom: 3 }}>
            <div style={{ width: 10, fontSize: 8, color: K.muted, textAlign: "left" }}>{HM_DOW[r]}</div>
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
                    flex: 1, aspectRatio: "1", borderRadius: 3.5,
                    background: fut ? "transparent" : lvl === 0 ? K.border : K.acc + MAP_AL[lvl - 1],
                    boxShadow: ymd === td && !fut ? `inset 0 0 0 1.5px ${K.acc}` : "none",
                    cursor: fut ? "default" : "pointer",
                  }} />
              );
            })}
          </div>
        ))}
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 4, paddingRight: 2 }}>
          <span style={{ fontSize: 8, color: K.muted, marginRight: 3 }}>Less</span>
          {[0, 1, 2, 3, 4, 5].map((l) => (
            <span key={l} aria-hidden="true" style={{
              width: 9, height: 9, borderRadius: 2,
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
        new Notification("Focusly", { body: p === 0 ? "Focus session complete — time for a break." : "Break's over — ready to focus?" });
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

  const goPhase = (i) => { setOn(false); setPhase(i); phR.current = i; setT(DURS[i]); tR.current = DURS[i]; };
  const reset   = () => { setOn(false); setT(DURS[phase]); tR.current = DURS[phase]; };

  const mm = pad2(Math.floor(t / 60));
  const ss = pad2(t % 60);
  const R = 90, circ = 2 * Math.PI * R;
  const prog = 1 - t / DURS[phase];
  const col  = F_COLS()[phase];

  return (
    <div style={{ padding: "20px 16px" }}>
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
          { I: on ? Pause : Play, w: 80, a11y: on ? "Pause" : "Start", primary: true, onClick: () => { primeAudio(); setOn((x) => !x); } },
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
    <div style={{ padding: "20px 16px" }}>
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

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {filt.length === 0 && (
          <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: 40 }}>
            {filter === "today" ? "✓ All done today!" : "No tasks here"}
          </div>
        )}
        {filt.map((task) => (
          <div key={task.id} style={{
            ...card2(), display: "flex", alignItems: "center", gap: 10,
            opacity: task.completed ? 0.5 : 1, transition: "opacity .2s",
          }}>
            <div style={{ width: 3, height: 28, borderRadius: 2, flexShrink: 0, background: PCOL()[task.pri] }} />
            <button type="button" className="b"
              onClick={() => toggle(task.id)}
              aria-label={task.completed ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
              aria-pressed={task.completed}
              style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                border: `2px solid ${task.completed ? K.ok : K.border}`,
                background: task.completed ? K.ok + "22" : "transparent",
                color: task.completed ? K.ok : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .2s",
              }}><Check size={13} strokeWidth={3.5} color={task.completed ? K.ok : "transparent"} /></button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, color: task.completed ? K.muted : K.txt,
                textDecoration: task.completed ? "line-through" : "none",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{task.title}</div>
              <div style={{ fontSize: 10, color: K.muted, marginTop: 2 }}>
                {task.cat}{task.due ? ` · ${task.due}` : ""}
              </div>
            </div>
            <button type="button" className="b" onClick={() => del(task.id)}
              aria-label={`Delete task "${task.title}"`}
              style={{ color: K.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}><X size={15} color={K.muted} /></button>
          </div>
        ))}
      </div>
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
  const [sel,     setSel]     = useState(null);
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
    <div style={{ padding: "20px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: 0 }}>Calendar</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="b" onClick={() => setCur(new Date(Y, M - 1, 1))}
            aria-label="Previous month"
            style={{ color: K.sub, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={20} color={K.sub} /></button>
          <div style={{ fontSize: 13, fontWeight: 600, color: K.txt, minWidth: 110, textAlign: "center" }}>{MNS[M]} {Y}</div>
          <button type="button" className="b" onClick={() => setCur(new Date(Y, M + 1, 1))}
            aria-label="Next month"
            style={{ color: K.sub, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={20} color={K.sub} /></button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 5 }}>
        {DNS.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 9, color: K.muted, padding: "3px 0", fontWeight: 700 }}>{d}</div>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 20 }}>
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
                aspectRatio: "1", borderRadius: 8, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: isS ? K.acc : isT ? K.accDim : "transparent",
                border: `1px solid ${isS ? K.acc : isT ? K.acc + "60" : "transparent"}`,
                transition: "all .15s",
              }}>
              <span style={{ fontSize: 11, color: isS ? "#fff" : isT ? K.acc : K.txt, fontWeight: isT ? 700 : 400 }}>{d}</span>
              {dts.length > 0 && (
                <span style={{ display: "flex", gap: 1.5, marginTop: 2 }}>
                  {dts.slice(0, 3).map((t, i) => (
                    <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {sel && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: K.txt }}>{MNL[M]} {sel}</div>
            <button type="button" className="b" onClick={() => setShowAdd((v) => !v)}
              aria-expanded={showAdd}
              style={{ ...tag(showAdd, K.acc), padding: "5px 12px", display: "flex", alignItems: "center", gap: 3 }}>
              {showAdd ? <X size={12} color={K.acc} /> : <><Plus size={12} color={K.sub} /> Add</>}
            </button>
          </div>
          {showAdd && (
            <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
              <input autoFocus style={{ ...inpSt(), flex: 1, padding: "8px 12px" }} placeholder="Add task for this day…"
                value={newT} onChange={(e) => setNewT(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQ()} />
              <button type="button" className="b" onClick={addQ} aria-label="Add task for this day"
                style={{ padding: "9px 15px", borderRadius: 8, background: K.acc, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} color="#fff" /></button>
            </div>
          )}
          {st.length === 0 ? (
            <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: 14 }}>No tasks this day</div>
          ) : st.map((t) => (
            <div key={t.id} style={{ ...card2(), marginBottom: 7, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 3, height: 22, borderRadius: 2, background: t.completed ? K.ok : t.pri === "high" ? K.err : K.acc }} />
              <div style={{ flex: 1, fontSize: 13, color: t.completed ? K.muted : K.txt, textDecoration: t.completed ? "line-through" : "none" }}>{t.title}</div>
              <div style={{ fontSize: 10, color: K.muted }}>{t.cat}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// APPS / TRACKER
// ══════════════════════════════════════════════════════════════════════════
const ICS = ["📱","🌐","📺","🎮","📸","💬","🎵","📧","🛒","📰","🐦","📷"];

function Apps({ user }) {
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
    <div style={{ padding: "20px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: 0 }}>App tracker</h2>
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
        {total}m used today ·{" "}
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

  const doAdd = async () => {
    const un = fi.toLowerCase().trim();
    if (!un) return;
    if (un === user.un)        return setFerr("Can't add yourself.");
    if (friends.includes(un)) return setFerr("Already friends.");
    const ex = await S.get(`u:${un}`);
    if (!ex)                   return setFerr("User not found.");
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
          {e.tc || 0} tasks · {e.streak || 0}d streak
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: K.acc }}>{e.fm || 0}m</div>
        <div style={{ fontSize: 9, color: K.muted }}>focus</div>
      </div>
      {rm && <button type="button" className="b" onClick={() => rmFriend(e.un)}
        aria-label={`Remove ${e.name || e.un} from friends`}
        style={{ color: K.muted, fontSize: 18, padding: 4, lineHeight: 1 }}>×</button>}
    </div>
  );

  return (
    <div style={{ padding: "20px 16px" }}>
      <h2 style={{ color: K.txt, fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>Social</h2>

      {/* My rank card */}
      {myData && (
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
        board.length === 0
          ? <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: 40 }}>No users yet 🏆</div>
          : board.slice(0, 25).map((e, i) => <Row key={e.un} e={e} rank={i + 1} />)
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
            <div style={{ textAlign: "center", color: K.muted, fontSize: 13, padding: 30 }}>Add friends to compete 👥</div>
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
    <div style={{ padding: "20px 16px" }}>
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
        <div style={{ display: "flex", gap: 10, overflowX: "auto", alignItems: "flex-start", paddingBottom: 6, margin: "0 -16px", paddingLeft: 16, paddingRight: 16 }}>
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
  // Theme follows the device automatically (light or dark) with no manual
  // toggle — the Apple approach. `K` below picks the matching palette.
  const [dark] = useState(() => {
    try { return window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : false; }
    catch { return false; }
  });
  K = dark ? D : L; // activate palette for this render pass

  useEffect(() => {
    S.get("sess").then(async (s) => {
      if (s?.un) {
        const u = await S.get(`u:${s.un}`);
        if (u) setUser({ un: s.un, ...u });
      }
      setBoot(false);
    });
  }, []);

  const login  = async (u) => { setUser(u); await S.set("sess", { un: u.un }); };
  const logout = async ()  => { await S.del("sess"); setUser(null); setTab("home"); };

  // Every screen renders from the in-memory `user` object, but edits (tasks,
  // friends, apps) are persisted to storage by whichever screen made them.
  // Reload the user record on navigation so no screen shows stale data after
  // another screen changed it.
  const goTab = (id) => {
    setTab(id);
    S.get(`u:${user.un}`).then((u) => {
      if (u) setUser((p) => (p && p.un === user.un ? { un: user.un, ...u } : p));
    });
  };
  const TABS = [
    { id: "home",     I: HomeIcon,   lbl: "Home"   },
    { id: "focus",    I: Timer,      lbl: "Focus"  },
    { id: "tasks",    I: ListChecks, lbl: "Tasks"  },
    { id: "boards",   I: LayoutGrid, lbl: "Boards" },
    { id: "calendar", I: Calendar,   lbl: "Cal"    },
    { id: "apps",     I: Shield,     lbl: "Apps"   },
    { id: "social",   I: Users,      lbl: "Social" },
  ];

  const pages = user ? {
    home:     <Home     user={user} go={goTab} />,
    focus:    <Focus    user={user} />,
    tasks:    <Tasks    user={user} />,
    boards:   <Boards   user={user} />,
    calendar: <Cal      user={user} />,
    apps:     <Apps     user={user} />,
    social:   <Social   user={user} />,
  } : {};

  /* ── LOADING ── */
  if (boot) return (
    <>
      {G(dark)}
      <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Zap size={36} color={K.acc} />
      </div>
    </>
  );

  /* ── AUTH ── */
  if (!user) return <Auth onLogin={login} dark={dark} />;

  /* ── APP SHELL ── */
  return (
    <div style={{
      minHeight: "100vh", background: K.bg, fontFamily: FONT,
      maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column",
      position: "relative",
    }}>
      {G(dark)}
      {/* ─ Header ─ */}
      <div style={{
        padding: "12px 16px", borderBottom: `1px solid ${K.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 10,
        background: dark ? "rgba(20, 20, 22, 0.78)" : "rgba(249, 249, 251, 0.8)",
        backdropFilter: "saturate(180%) blur(18px)",
        WebkitBackdropFilter: "saturate(180%) blur(18px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: K.acc,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Zap size={14} color="#fff" fill="#fff" /></div>
          <span style={{ fontSize: 15, fontWeight: 700, color: K.txt, letterSpacing: -0.2 }}>Focusly</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: K.acc,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 800,
          }}>{(user.name || user.un)[0].toUpperCase()}</div>
          <button type="button" className="b" onClick={logout}
            style={{ fontSize: 11, color: K.muted, padding: "4px 2px" }}>Sign out</button>
        </div>
      </div>

      {/* ─ Content ─ */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
        {pages[tab]}
      </div>

      {/* ─ Bottom Nav ─ */}
      <nav aria-label="Main" style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
        background: dark ? "rgba(20, 20, 22, 0.8)" : "rgba(249, 249, 251, 0.85)",
        backdropFilter: "saturate(180%) blur(18px)",
        WebkitBackdropFilter: "saturate(180%) blur(18px)",
        borderTop: `1px solid ${K.border}`, display: "flex",
        padding: "4px 0 10px", zIndex: 20,
      }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" className="b" onClick={() => goTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 0 2px",
            }}>
            <t.I aria-hidden="true" size={17} strokeWidth={2}
              color={tab === t.id ? K.acc : K.muted}
              style={{ transition: "all .15s", transform: tab === t.id ? "translateY(-1px)" : "none" }} />
            <span style={{
              fontSize: 9, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? K.acc : K.muted, letterSpacing: 0.4,
            }}>{t.lbl.toUpperCase()}</span>
            {tab === t.id && (
              <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: "50%", background: K.acc, marginTop: 1 }} />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
