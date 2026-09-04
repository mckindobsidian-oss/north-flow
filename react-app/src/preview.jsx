// ── PREVIEW HARNESS (browser-only shim for the host `window.storage` API) ──
// The real Focusly host app provides window.storage; in a plain browser we
// back it with an in-memory Map so the app runs and persists for the session.
const mem = new Map();
window.storage = {
  async get(k, s) {
    const v = mem.get((s ? "s:" : "") + k);
    return v === undefined ? null : { value: v };
  },
  async set(k, v, s) { mem.set((s ? "s:" : "") + k, v); },
  async delete(k, s) { mem.delete((s ? "s:" : "") + k); },
  async list(p, s) {
    // Host returns keys WITHOUT the shared prefix (app does `k.slice(3)`).
    const prefix = (s ? "s:" : "") + p;
    return {
      keys: [...mem.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => (s ? k.slice(2) : k)),
    };
  },
};

// ── DEMO DATA ─────────────────────────────────────────────────────────────
const today = new Date();
const dstr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const td = dstr(today);
const tmrw = dstr(new Date(today.getTime() + 86400000));

window.storage.set("sess", JSON.stringify({ un: "demo" }));
window.storage.set(
  "u:demo",
  JSON.stringify({
    pw: "x",
    name: "Aarav",
    tasks: [
      { id: "t1", title: "Ship the landing page", due: td, pri: "high", cat: "Work", completed: false, at: Date.now(), boardId: "prod", colId: "doing" },
      { id: "t2", title: "Morning run", due: td, pri: "medium", cat: "Health", completed: true, at: Date.now(), boardId: "pers", colId: "done" },
      { id: "t3", title: "Read 20 pages", due: td, pri: "low", cat: "Study", completed: false, at: Date.now(), boardId: "prod", colId: "todo" },
      { id: "t4", title: "Plan the week", due: tmrw, pri: "medium", cat: "Personal", completed: false, at: Date.now(), boardId: "pers", colId: "todo" },
      { id: "t5", title: "Record demo video", due: tmrw, pri: "high", cat: "Work", completed: false, at: Date.now(), boardId: "prod", colId: "doing" },
    ],
    apps: [
      { id: "a1", name: "Instagram", icon: "📸", limit: 45, used: 30, blocked: false, lastD: td },
      { id: "a2", name: "YouTube", icon: "📺", limit: 60, used: 68, blocked: false, lastD: td },
      { id: "a3", name: "Games", icon: "🎮", limit: 30, used: 0, blocked: true, lastD: td },
    ],
    friends: ["riya", "dev"],
    pm: { w: 25, sb: 5, lb: 15 },
  })
);
// Kanban boards for the demo account (cards are the tasks above).
window.storage.set("bd:demo", JSON.stringify([
  {
    id: "prod", name: "Product Launch",
    cols: [
      { id: "todo", name: "To do" },
      { id: "doing", name: "Doing" },
      { id: "done", name: "Done" },
    ],
  },
  {
    id: "pers", name: "Personal",
    cols: [
      { id: "todo", name: "To do" },
      { id: "doing", name: "Doing" },
      { id: "done", name: "Done" },
    ],
  },
]));
window.storage.set("lb:demo", JSON.stringify({ name: "Aarav", fm: 240, tc: 42, streak: 6, last: td }), true);
window.storage.set("lb:riya", JSON.stringify({ name: "Riya", fm: 310, tc: 55, streak: 9, last: td }), true);
window.storage.set("lb:dev", JSON.stringify({ name: "Dev", fm: 120, tc: 20, streak: 2, last: td }), true);

// ── DEMO FOCUS HISTORY ────────────────────────────────────────────────────
// Plausible recorded focus totals over the past ~75 days so the activity
// heatmap and stats have real data in the preview. Deterministic per date
// (derived from the date itself), so it looks the same on every reload.
// Real accounts start empty — sessions the user completes append to these
// same daily records (`fo:` totals, `fs:` per-session records).
{
  const seeded = (d) => {
    const n = Math.floor(d.getTime() / 86400000);
    const r = ((n * 2654435761) >>> 0) % 100; // stable pseudo-random hash
    const dow = (d.getDay() + 6) % 7;          // 0 = Monday
    if (r < 8) return 0;                       // ~8% rest days
    return dow >= 5 ? 15 + (r % 45) : 45 + (r % 80); // weekends lighter
  };
  for (let i = 75; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const min = seeded(d);
    if (min > 0) window.storage.set(`fo:demo:${dstr(d)}`, JSON.stringify({ s: min * 60 }));
  }
  // Two completed focus sessions from earlier today, so the Focus screen
  // history and session count aren't empty on first load.
  const s1 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0, 0);
  const s2 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 40, 0, 0);
  window.storage.set(`fs:demo:${td}`, JSON.stringify([
    { id: "s1", type: "focus", start: s1.getTime(), end: s1.getTime() + 1500000, planned: 1500, actual: 1500, completed: true },
    { id: "s2", type: "focus", start: s2.getTime(), end: s2.getTime() + 1500000, planned: 1500, actual: 1500, completed: true },
  ]));
  window.storage.set(`fo:demo:${td}`, JSON.stringify({ s: 3000 })); // matches the 2 records
}

import App from "./focusly.jsx";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(<App />);
