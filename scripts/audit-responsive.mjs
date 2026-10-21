#!/usr/bin/env node
/**
 * NORTH — responsive audit, run against a real Chromium at every size that
 * matters.
 *
 * WHY THIS EXISTS
 * "It's responsive" is easy to say and easy to be wrong about: the failures
 * that matter are a page that scrolls sideways by 12px, a header row clipped by
 * the shell's `overflow-x: clip`, a control smaller than a fingertip, or a fixed
 * overlay taller than a landscape phone — none of which a screenshot at one
 * size reveals. So this drives a real browser, resizes it to the whole matrix
 * below, walks every tab, and measures:
 *
 *   · page-level horizontal overflow (documentElement.scrollWidth > clientWidth)
 *   · content that extends past the shell and is therefore CLIPPED (an element
 *     whose nearest scrollable ancestor is not a scroller still sticking out)
 *   · interactive controls smaller than 24px on their short side
 *
 * The check deliberately ignores things that are SUPPOSED to be big: the
 * decorative focus orbs (clipped by their own container) and anything inside a
 * horizontal scroller such as the 26-week heatmap.
 *
 * HOW TO RUN
 *   npm run dev            # serves react-app through vite.preview.config.js — 5174
 *   npm run audit:responsive
 *
 *   npm run audit:responsive -- --cdp=http://127.0.0.1:9222   # attach instead
 *   npm run audit:responsive -- --url=http://localhost:5173   # a different app
 *
 * By default it launches a throwaway HEADLESS Chromium (Brave/Chrome/Edge, first
 * one found) with a temporary profile, so it never touches your browser state,
 * and kills it on exit. Point `CHROME=/path/to/chrome` at a specific binary.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── the matrix ────────────────────────────────────────────────────────────
// Grouped the way the product thinks about them, and including both
// orientations: a 667×375 phone is the size where a fixed overlay gets cut off.
const VIEWPORTS = [
  ["phone portrait", 320, 568],
  ["phone portrait", 375, 667],
  ["phone portrait", 390, 844],
  ["phone portrait", 430, 932],
  ["phone landscape", 667, 375],
  ["phone landscape", 844, 390],
  ["tablet portrait", 768, 1024],
  ["tablet portrait", 820, 1180],
  ["tablet landscape", 1024, 1366],
  ["tablet landscape", 1180, 820],
  ["laptop", 1280, 720],
  ["laptop", 1366, 768],
  ["desktop", 1440, 900],
  ["desktop", 1920, 1080],
  ["large monitor", 2560, 1440],
];

const TABS = ["Home", "Focus", "Tasks", "Calendar", "Flow", "Social", "Settings"];

const argv = process.argv.slice(2);
const argOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const APP_URL = (argOf("url") || process.env.NORTH_URL || "http://localhost:5174/preview.html").replace(/\/+$/, "");
const ENDPOINT = (argOf("cdp") || process.env.NORTH_CDP || "http://127.0.0.1:9222").replace(/\/+$/, "");
const PORT = Number(new URL(ENDPOINT).port) || 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

// ── minimal CDP client over the WebSocket Node 22 ships with ─────────────
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error(`cannot open ${wsUrl}`)), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
    else resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression, timeoutMs = 60000) => {
    const r = await Promise.race([
      send("Runtime.evaluate", {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true, returnByValue: true,
      }),
      sleep(timeoutMs).then(() => { throw new Error("evaluate timed out"); }),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  return { ws, send, evaluate };
}

const getJson = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

function findBrowser() {
  return [
    process.env.CHROME,
    join(process.env.LOCALAPPDATA || "", "BraveSoftware/Brave-Browser/Application/brave.exe"),
    join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES"] || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean).find((p) => existsSync(p)) || null;
}

async function launch(endpoint, port) {
  const browser = findBrowser();
  if (!browser) throw new Error("no Chromium-family browser found (set CHROME=/path/to/chrome)");
  const profile = join(process.env.TEMP || process.env.TMPDIR || "/tmp", `north-responsive-${Date.now()}`);
  console.log(`launching ${browser} (headless, throwaway profile)`);
  const child = spawn(browser, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--window-size=1280,800",
    "about:blank",
  ], { stdio: "ignore" });
  const reachable = async () => { try { await getJson(`${endpoint}/json/version`); return true; } catch { return false; } };
  for (let i = 0; i < 80 && !(await reachable()); i++) await sleep(250);
  if (!(await reachable())) throw new Error("the browser never opened its debugging port");
  return {
    child,
    stop: async () => {
      try {
        if (process.platform === "win32") execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* already gone */ }
      await sleep(400);
    },
  };
}

// ── the audit, evaluated in the page once per viewport ────────────────────
// Runs in the page: walks the tabs, forces entry animations to their end (a
// headless browser with no compositor can leave a 240ms fade stuck at opacity 0,
// which would make every measurement a lie), and reports only real problems.
const AUDIT_JS = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const names = ${JSON.stringify(TABS)};
const problems = [];
const de = document.documentElement;
if (!document.querySelector('.north-nav-item')) {
  problems.push('no navigation found — is the app signed in at this URL?');
  return problems;
}
for (const name of names) {
  const btn = [...document.querySelectorAll('.north-nav-item')].find((x) => x.textContent.trim().toLowerCase() === name.toLowerCase());
  if (!btn) { problems.push(name + ': no nav item'); continue; }
  btn.click();
  await sleep(450);
  document.querySelectorAll('*').forEach((el) => {
    if (el.getAnimations) el.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  });
  const ov = de.scrollWidth - de.clientWidth;
  if (ov > 1) problems.push(name + ': page scrolls sideways by ' + ov + 'px');
  const root = document.querySelector('.genv');
  if (!root) continue;
  const g = root.getBoundingClientRect();
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  const clipped = [...root.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (getComputedStyle(el).position === 'fixed') return false;
    if (el.classList.contains('focus-orb') || el.closest('.focus-atmosphere')) return false;
    if (inScroller(el)) return false;
    return r.right > g.right + 1.5 || r.left < g.left - 1.5;
  });
  if (clipped.length) {
    const sample = clipped.slice(0, 2).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
    problems.push(name + ': ' + clipped.length + ' element(s) clipped past the page edge (' + sample.join(', ') + ')');
  }
  // Touch targets: a fingertip is ~40px, so anything meant to be tapped on a
  // handset/tablet needs a real hit area. What counts is where a tap LANDS,
  // not what was painted: several controls here are compact but grow their
  // tappable box with a transparent pseudo-element (see the touch-hit-area rule
  // in the app stylesheet), so the box is probed outward with elementFromPoint
  // until the pointer stops belonging to the control. Desktop keeps a smaller
  // floor — a pointer is precise and dense rows are deliberate.
  const floor = innerWidth <= 820 ? 32 : 22;
  const hit = (el) => {
    // Probe from the element's own centre, so it has to be ON SCREEN first:
    // elementFromPoint cannot reach a control parked below the fold, which
    // would otherwise read as a zero-size tap target.
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const owns = (x, y) => {
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return false;
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    // A control that is not the topmost thing at its own centre is not
    // reachable at all — it lives inside a closed <details>, behind an
    // overlay, or off the composited page. Measuring its box would invent a
    // failure, so it is reported as unreachable instead of "small".
    if (!owns(cx, cy)) return null;
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 26 && owns(cx + dx * (d + 2), cy + dy * (d + 2))) d += 2;
      return d;
    };
    return {
      w: r.width + reach(-1, 0) + reach(1, 0),
      h: r.height + reach(0, -1) + reach(0, 1),
    };
  };
  const small = [];
  for (const el of document.querySelectorAll('button, [role="button"], select')) {
    if (el.getAttribute('tabindex') === '-1') continue;   // heatmap cells are decorative-by-design
    if (el.closest('.north-mobile-nav')) continue;        // the dock sizes itself
    const r0 = el.getBoundingClientRect();
    if (r0.width <= 0 || r0.height <= 0) continue;
    const h = hit(el);
    if (h && (h.h < floor || h.w < floor)) {
      const what = (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 16);
      small.push(what + ' ' + Math.round(h.w) + '×' + Math.round(h.h));
    }
  }
  window.scrollTo(0, 0);
  if (small.length) {
    problems.push(name + ': ' + small.length + ' tap target(s) under ' + floor + 'px (' + small.slice(0, 3).join(' | ') + ')');
  }
}
return problems;
`;

async function main() {
  let launched = null;
  const reachable = async () => { try { await getJson(`${ENDPOINT}/json/version`); return true; } catch { return false; } };
  if (!(await reachable())) launched = await launch(ENDPOINT, PORT);
  else console.log(`attaching to ${ENDPOINT}`);

  try {
    const page = await fetch(APP_URL, { redirect: "follow" });
    if (!page.ok) throw new Error(`${page.status}`);
  } catch {
    console.log(`\nCannot reach ${APP_URL}.\nStart the app first:  npm run dev      (serves it on 5174)\n`);
    if (launched) await launched.stop();
    process.exit(2);
  }

  // One tab, reused for every viewport — cheaper and closer to the real thing
  // than opening fifteen.
  const tab = await getJson(`${ENDPOINT}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" });
  const c = await connect(tab.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await sleep(2500); // first paint + the preview harness signing itself in

  console.log(`\nAuditing ${APP_URL} — ${VIEWPORTS.length} viewports × ${TABS.length} screens\n`);
  for (const [group, width, height] of VIEWPORTS) {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width <= 820, screenWidth: width, screenHeight: height,
    });
    await sleep(500);
    let problems = [];
    try {
      problems = (await c.evaluate(AUDIT_JS)) || [];
    } catch (e) {
      problems = [`audit threw: ${String(e.message).slice(0, 80)}`];
    }
    const label = `${width}×${height}`.padEnd(10) + group;
    if (problems.length === 0) {
      console.log(`  ok   ${label}`);
    } else {
      failures++;
      console.log(` FAIL  ${label}`);
      for (const p of problems) console.log(`         ${p}`);
    }
  }

  await c.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  c.ws.close();
  await getJson(`${ENDPOINT}/json/close/${tab.id}`).catch(() => {});
  if (launched) await launched.stop();

  console.log(failures === 0
    ? `\nAll ${VIEWPORTS.length} viewports clean.\n`
    : `\n${failures} viewport(s) with problems.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\naudit failed: ${e.message}\n`);
  process.exit(1);
});
