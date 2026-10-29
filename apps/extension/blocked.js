/**
 * NORTH — the block page.
 *
 * Everything on screen comes from two places and nothing else: the reason code
 * the worker put in this page's own query string (lib/block-reason.js decides
 * the words), and the extension's own storage for the countdown. The page never
 * invents a reason, and it never carries a token, a user id, or the full URL
 * that was blocked — only the domain and why.
 *
 * The blocked request itself was already stopped by the browser before this
 * page existed; this is the explanation, not the enforcement.
 */
import { parseBlockParams, describeBlock } from "./lib/block-reason.js";
import { applyTheme } from "./lib/appearance.js";
import { isTrustedOrigin } from "./lib/external.js";

const $ = (id) => document.getElementById(id);
applyTheme();
chrome.storage.local.get(["northThemeId", "northAppearance"]).then(({ northThemeId, northAppearance }) => applyTheme(northThemeId, northAppearance)).catch(() => {});

/** Where "Open North Flow" goes. Stored by the popup's project settings. */
const DEFAULT_NORTH_URL = "http://localhost:5174";

const { domain, code, names, minutesLeft, ruleId } = parseBlockParams(location.search);
const copy = describeBlock({ code, domain, names, minutesLeft });

$("badge").textContent = copy.badge;
$("headline").textContent = copy.headline;
$("detail").textContent = copy.detail;
$("domain").textContent = domain || "This website";

if (copy.tone === "focus") {
  $("card").classList.add("focus");
}

// A countdown, so "Focus Mode is running" is also a real answer to "for how
// long?". Re-read from storage rather than trusting the query string, because
// Focus Mode can be paused from the popup while this page is open.
let endAt = minutesLeft > 0 ? Date.now() + minutesLeft * 60_000 : 0;
function renderTimer() {
  if (!endAt) { $("timer").classList.add("hide"); return; }
  const left = endAt - Date.now();
  if (left <= 0) {
    $("timer").classList.add("hide");
    return;
  }
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  $("timer").textContent = `Focus session ends in ${mins}:${String(secs).padStart(2, "0")}`;
  $("timer").classList.remove("hide");
  setTimeout(renderTimer, 1000);
}

if (endAt) {
  renderTimer();
  // The truth, from the same storage the worker writes.
  chrome.storage.local.get("northBlocking").then(({ northBlocking }) => {
    const live = northBlocking?.focus?.endAt;
    endAt = Number(live) > Date.now() ? Number(live) : endAt;
  }).catch(() => {});
}

$("openNorth").onclick = async () => {
  let url = DEFAULT_NORTH_URL;
  try {
    const { northWebUrl } = await chrome.storage.local.get("northWebUrl");
    if (northWebUrl && isTrustedOrigin(new URL(northWebUrl).origin)) url = northWebUrl;
  } catch { /* unset — the default is still a real destination */ }
  const flow = new URL(url);
  flow.searchParams.set("tab", "flow");
  if (domain) flow.searchParams.set("site", domain);
  chrome.tabs.create({ url: flow.toString() });
};

$("oneMinute").onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: "blockPageUnblock", host: domain, id: ruleId });
  if (!result?.ok) $("detail").textContent = result?.error || "Could not temporarily allow this website.";
};

$("back").onclick = () => {
  // -2 rather than -1: -1 is this block page, so it would land right back here.
  if (history.length > 1) history.go(-2);
  else location.replace("about:blank");
};
