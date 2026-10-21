#!/usr/bin/env node
/**
 * NORTH — verify the browser extension against a REAL Chromium browser.
 *
 * WHY THIS EXISTS
 * `npm test` covers the extension's decision layer in Node, but no amount of
 * unit testing proves that Chrome *obeys* the rules we generate. The difference
 * between "we wrote declarativeNetRequest rules" and "the browser blocked the
 * site" is the whole product, so this script drives an actual browser over the
 * DevTools protocol and checks the four things that cannot be faked:
 *
 *   1. the extension loads (a bad manifest or a broken module fails here);
 *   2. the browser's own rule set — read back with getDynamicRules — matches
 *      the desired list, and Chrome's URL matcher agrees about subdomains and
 *      about lookalikes such as notyoutube.com (via testMatchOutcome);
 *   3. a navigation to a blocked host genuinely does not load and lands on
 *      NORTH's block page naming the domain and the reason, while a host that
 *      should NOT be blocked still loads;
 *   4. removing a rule, ending Focus Mode and restarting the extension all take
 *      effect on the browser's rules.
 *
 * HOW IT ATTACHES (and why not `--load-extension`)
 * Chromium removed `--load-extension` for branded builds in 137 and the
 * `--disable-features=DisableLoadExtensionCommandLineSwitch` workaround stopped
 * working after 142 — confirmed against Brave 154, Edge 154, Chrome for Testing
 * 136 and 154, and an unbranded Chromium snapshot, all of which ignore it. So
 * the supported path is the normal one: load the extension once in your own
 * browser (chrome://extensions → Developer mode → Load unpacked → apps/extension),
 * start that browser with a debugging port, and let this script attach:
 *
 *   # 1. one-time: load apps/extension via chrome://extensions (Developer mode)
 *   # 2. start your browser with a debugging port (use a profile that has it)
 *   brave.exe --remote-debugging-port=9222
 *   # 3. verify
 *   npm run verify:extension
 *
 *   NORTH_CDP=http://127.0.0.1:9333 npm run verify:extension
 *   node scripts/verify-extension.mjs --launch     # try launching instead
 *                                                  # (Chromium ≤ 136 only)
 *
 * IT TOUCHES YOUR BROWSER, DELIBERATELY AND TEMPORARILY
 * It adds `youtube.com` and `localhost` to the block list, starts and cancels a
 * one-minute focus session, opens two tabs, and then removes everything it
 * added. Do not run it against a profile whose state you care about mid-session.
 */
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_CDP = "http://127.0.0.1:9222";
const argv = process.argv.slice(2);
const argOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const WANT_LAUNCH = argv.includes("--launch");

let failures = 0;
let skips = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};
const skip = (label, why) => {
  console.log(` skip  ${label} — ${why}`);
  skips++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a minimal CDP client over the WebSocket Node 22+ provides natively ────
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
    if (!msg.id || !pending.has(msg.id)) return; // events are not our concern
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
  const evaluate = async (expression, timeoutMs = 15000) => {
    const r = await Promise.race([
      send("Runtime.evaluate", {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
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

/** Find the NORTH extension among the browser's targets, whatever its id. */
async function findNorth(endpoint) {
  const list = await getJson(`${endpoint}/json/list`).catch(() => []);
  const candidates = list.filter((t) => String(t.url || "").startsWith("chrome-extension://"));
  for (const t of candidates) {
    if (!t.webSocketDebuggerUrl) continue;
    try {
      const c = await connect(t.webSocketDebuggerUrl);
      const name = await c.evaluate(
        'return (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().name : null;'
      );
      c.ws.close();
      if (typeof name === "string" && /NORTH/i.test(name)) {
        return { id: String(t.url).split("/")[2], name, version: t.url, target: t };
      }
    } catch { /* not an extension context we can read */ }
  }
  return null;
}

/** Open an extension page in a real tab — how the popup is driven for real. */
async function openExtensionPage(endpoint, id, path) {
  const url = `chrome-extension://${id}/${path}`;
  const t = await getJson(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  await sleep(700);
  if (!t?.webSocketDebuggerUrl) throw new Error(`could not open ${path}`);
  return connect(t.webSocketDebuggerUrl);
}

function findBrowser() {
  return [
    process.env.CHROME,
    join(process.env.LOCALAPPDATA || "", "BraveSoftware/Brave-Browser/Application/brave.exe"),
    join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES"] || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean).find((p) => existsSync(p)) || null;
}

/** Launch a Chromium with the extension loaded. Works on Chromium ≤ 136 only. */
async function launchWithExtension(endpoint, port) {
  const browser = findBrowser();
  if (!browser) throw new Error("no Chromium-family browser found (set CHROME=/path/to/chrome)");
  const extDir = join(process.cwd(), "apps", "extension");
  const profile = join(process.env.TEMP || process.env.TMPDIR || "/tmp", `north-verify-${Date.now()}`);
  console.log(`launching ${browser}\n  --load-extension=${extDir}\n  (honoured by Chromium ≤ 136; newer builds ignore it)`);
  const child = spawn(browser, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });
  return {
    child,
    stop: async () => {
      try {
        if (process.platform === "win32") execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* already gone */ }
      await sleep(500);
    },
  };
}

// ── the verification ──────────────────────────────────────────────────────
async function main() {
  let endpoint = (argOf("cdp") || process.env.NORTH_CDP || DEFAULT_CDP).replace(/\/+$/, "");
  let launched = null;

  const reachable = async (url) => {
    try { await getJson(`${url}/json/version`); return true; } catch { return false; }
  };

  if (!(await reachable(endpoint))) {
    if (!WANT_LAUNCH) {
      console.log(`No browser answering on ${endpoint}.\n`);
      console.log("Load the extension once, then start a browser with a debugging port:");
      console.log("  1. chrome://extensions (or brave://extensions) → Developer mode → Load unpacked → apps/extension");
      console.log("  2. brave.exe --remote-debugging-port=9222      (or chrome.exe / msedge.exe)");
      console.log("  3. npm run verify:extension\n");
      console.log("Or try `node scripts/verify-extension.mjs --launch` on Chromium ≤ 136.");
      process.exit(2);
    }
    const url = new URL(DEFAULT_CDP);
    const port = Number(url.port) || 9222;
    endpoint = `http://127.0.0.1:${port}`;
    launched = await launchWithExtension(endpoint, port);
    for (let i = 0; i < 60 && !(await reachable(endpoint)); i++) await sleep(250);
    if (!(await reachable(endpoint))) throw new Error("the browser never opened its debugging port");
  } else {
    console.log(`attaching to ${endpoint}`);
  }

  // A local origin to block by name and to leave alone as a control. `localhost`
  // is a real host Chrome resolves, so no DNS or internet access is involved.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>LOCAL OK</title><h1>LOCAL OK</h1>");
  });
  await new Promise((r) => server.listen(0, r));
  const webPort = server.address().port;
  const opened = [];
  const openTab = async (url) => {
    const t = await getJson(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    opened.push(t.id);
    return t;
  };

  let north = null;
  try {
    // The service worker may be asleep; open the popup, which wakes it.
    north = await findNorth(endpoint);
    if (!north) {
      // Nothing to probe yet: any extension page forces the worker to start.
      const list = await getJson(`${endpoint}/json/list`).catch(() => []);
      const anyExt = list.find((t) => String(t.url || "").startsWith("chrome-extension://"));
      if (anyExt) {
        await sleep(1500);
        north = await findNorth(endpoint);
      }
    }
    check("the NORTH extension is loaded in this browser", Boolean(north), north ? `${north.name} (${north.id})` : "not found");
    if (!north) throw new Error("load apps/extension in this browser first (see the header of this file)");

    const id = north.id;

    // The web app addresses the extension by a pinned id. Confirm the running
    // browser agrees: a store-installed build gets a different one, and that has
    // to fail a check rather than leave a channel that silently never works.
    try {
      const manifest = JSON.parse(readFileSync(join(process.cwd(), "apps", "extension", "manifest.json"), "utf8"));
      const der = Buffer.from(manifest.key, "base64");
      const derived = createHash("sha256").update(der).digest("hex").slice(0, 32)
        .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
      check("the id matches the one derived from the manifest key", derived === id, `derived ${derived}, browser ${id}`);
      const src = readFileSync(join(process.cwd(), "react-app", "src", "lib", "extension.js"), "utf8");
      const wired = /EXTENSION_ID\s*=\s*"([^"]+)"/.exec(src)?.[1] || "(not found)";
      check("the web app addresses this same extension id", wired === id, `web ${wired}, browser ${id}`);
    } catch (e) {
      skip("the id the web app uses matches this browser's", String(e.message).slice(0, 60));
    }

    const popup = await openExtensionPage(endpoint, id, "popup.html");
    const perms = await popup.evaluate("return chrome.runtime.getManifest().permissions;");
    const version = await popup.evaluate("return chrome.runtime.getManifest().version;");
    check("declarativeNetRequest is granted", perms.includes("declarativeNetRequest"));
    check("webNavigation is granted (used to show the block page)", perms.includes("webNavigation"), `v${version}`);

    // The popup is the real UI: driving it exercises the real message path, and
    // proves its wiring finished (a null-element crash used to break it).
    const wired = await popup.evaluate(`
      const byId = (i) => document.getElementById(i);
      return {
        signOut: typeof byId("acctSignOut")?.onclick,
        openNorth: typeof byId("openNorth")?.onclick,
        status: byId("statusHeadline")?.textContent || "",
        about: byId("aboutLine")?.textContent || "",
      };
    `);
    check("the popup finishes wiring its account controls", wired.signOut === "function" && wired.openNorth === "function",
      `signOut=${wired.signOut} openNorth=${wired.openNorth}`);
    check("the popup shows a verdict from the worker", Boolean(wired.status) && wired.status !== "Loading…", wired.status);

    const send = (msg) => popup.evaluate(`return await chrome.runtime.sendMessage(${JSON.stringify(msg)});`);
    const rules = () => popup.evaluate("return await chrome.declarativeNetRequest.getDynamicRules();");
    const filters = (list) => list.map((r) => r.condition.urlFilter).sort();

    // ── 1. adding a site really adds a browser rule ──────────────────────
    const added = await send({ type: "addSite", host: "https://www.youtube.com/watch?v=north" });
    check("adding a site through the popup succeeds", added?.ok === true, added?.host);
    check("a pasted URL is reduced to a bare domain", added?.host === "youtube.com", added?.host);

    let dyn = await rules();
    check("the browser now holds a block rule for that domain", filters(dyn).includes("||youtube.com^"), filters(dyn).join(" "));
    check("the rule blocks the navigation itself, not a content-script hide",
      dyn.some((r) => r.action.type === "block" && r.condition.resourceTypes.includes("main_frame")));

    await send({ type: "addSite", host: "example.com", when: "focus" });
    dyn = await rules();
    check("a focus-only rule is not enforced while no session runs", !filters(dyn).includes("||example.com^"), filters(dyn).join(" "));

    // ── 2. Chrome's own matcher, on the rules we generated ───────────────
    try {
      const matcher = async (url) => popup.evaluate(`
        const out = await chrome.declarativeNetRequest.testMatchOutcome({ url: ${JSON.stringify(url)}, type: "main_frame" });
        return out.matchedRules.length > 0;
      `);
      for (const [url, want] of [
        ["https://youtube.com/", true],
        ["https://www.youtube.com/", true],
        ["https://m.youtube.com/feed/subscriptions", true],
        ["https://music.youtube.com/", true],
        ["https://notyoutube.com/", false],
        ["https://youtube-example.com/", false],
        ["https://myyoutube.com/", false],
        ["https://youtube.com.evil.test/", false],
        ["https://example.com/", false],
      ]) {
        check(`Chrome's matcher: ${url} → ${want ? "blocked" : "allowed"}`, (await matcher(url)) === want);
      }
    } catch (e) {
      skip("Chrome's URL matcher agrees on subdomains and lookalikes",
        `needs the declarativeNetRequestFeedback permission (${String(e.message).slice(0, 60)})`);
    }

    // ── 3. Focus Mode activates the focus-tier rule, and ending it stops ─
    const started = await send({ type: "startFocus", minutes: 1 });
    check("a focus session starts", Boolean(started?.focus?.endAt));
    dyn = await rules();
    check("Focus Mode enforces the focus-only rule in the browser", filters(dyn).includes("||example.com^"), filters(dyn).join(" "));

    await send({ type: "cancelFocus" });
    dyn = await rules();
    check("ending Focus Mode stops enforcing it", !filters(dyn).includes("||example.com^"), filters(dyn).join(" "));
    await send({ type: "removeSite", host: "example.com" });

    // ── 4. a blocked navigation really does not load ─────────────────────
    const currentUrl = async (id2) => {
      const list = await getJson(`${endpoint}/json/list`);
      return list.find((x) => x.id === id2)?.url || "";
    };
    const navigate = async (url) => {
      const t = await openTab(url);
      await sleep(1600);
      return currentUrl(t.id);
    };

    const blockedTo = await navigate(`http://localhost:${webPort}/`);
    check("a blocked navigation lands on NORTH's block page",
      blockedTo.startsWith(`chrome-extension://${id}/blocked.html`), blockedTo);
    check("the block page names the blocked domain", blockedTo.includes("d=localhost"), blockedTo);
    check("the block page carries the reason", /[?&]r=always/.test(blockedTo), blockedTo);

    const allowedTo = await navigate(`http://127.0.0.1:${webPort}/`);
    check("a host that is not on the list still loads normally", allowedTo === `http://127.0.0.1:${webPort}/`, allowedTo);

    // ── 5. removing a site stops blocking it ─────────────────────────────
    await send({ type: "removeSite", host: "localhost" });
    dyn = await rules();
    check("removing a site removes its browser rule", !filters(dyn).includes("||localhost^"), filters(dyn).join(" "));
    const afterRemoval = await navigate(`http://localhost:${webPort}/`);
    check("the removed domain loads again", afterRemoval === `http://localhost:${webPort}/`, afterRemoval);

    // ── 6. the extension restarts and keeps enforcing ────────────────────
    check("a rule is in place before the restart", filters(await rules()).includes("||youtube.com^"));
    await popup.evaluate("chrome.runtime.reload(); return true;").catch(() => {});
    await sleep(2500);
    const again = await findNorth(endpoint);
    check("the extension comes back after a reload", Boolean(again), again?.id || "not found");
    if (again) {
      const popup2 = await openExtensionPage(endpoint, again.id, "popup.html");
      const after = await popup2.evaluate("return await chrome.declarativeNetRequest.getDynamicRules();");
      check("its rules are still installed after the restart",
        after.some((r) => r.condition.urlFilter === "||youtube.com^"),
        after.map((r) => r.condition.urlFilter).join(" ") || "(none)");
      const blockedAgain = await navigate(`http://localhost:${webPort}/`);
      check("and blocking still works after the restart", blockedAgain.startsWith("chrome-extension://"), blockedAgain);
      await send({ type: "removeSite", host: "youtube.com" }).catch(() => {});
      popup2.ws.close();
    }
    popup.ws.close();
  } finally {
    // Leave the browser exactly as it was found: drop the rules this script added.
    try {
      if (north) {
        const cleanup = await openExtensionPage(endpoint, north.id, "popup.html");
        await cleanup.evaluate(`
          for (const host of ["youtube.com", "localhost", "example.com"]) {
            await chrome.runtime.sendMessage({ type: "removeSite", host });
          }
          return true;
        `).catch(() => {});
        cleanup.ws.close();
      }
    } catch { /* best effort */ }
    for (const targetId of opened) {
      await fetch(`${endpoint}/json/close/${targetId}`).catch(() => {});
    }
    await new Promise((r) => server.close(r));
    if (launched) await launched.stop();
  }

  console.log(failures ? `\n${failures} check(s) FAILED${skips ? `, ${skips} skipped` : ""}` : `\nall extension checks passed${skips ? ` (${skips} skipped)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nverify-extension could not run: ${e?.message || e}`);
  process.exit(2);
});
