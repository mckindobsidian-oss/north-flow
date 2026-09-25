/**
 * NORTH popup — a thin view over the service worker's snapshot.
 *
 * The popup deliberately does NOT evaluate blocking itself: it calls the worker
 * (`getState`), and the worker runs the same shared engine every other client
 * runs. One verdict, one implementation. User text always goes in through
 * textContent, so a hostname can never be interpreted as markup.
 */
import { WEEKDAY_LABELS, WORKDAYS } from "./lib/blocking.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

/** New-schedule draft, kept in the popup until the worker accepts it. */
let draftDays = [...WORKDAYS];
let snapshot = null;

/**
 * Tiny DOM builder. `props` are element properties (textContent, className,
 * title, onclick); anything in `attrs` goes through setAttribute, which is what
 * ARIA state needs (`aria-pressed` is an attribute, not a property).
 */
const el = (tag, { attrs, ...props } = {}, children = []) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  for (const c of [].concat(children)) node.append(c);
  return node;
};

const show = (node, visible) => node.classList.toggle("hide", !visible);

// ── render ────────────────────────────────────────────────────────────────
function render() {
  const s = snapshot;
  if (!s) return;

  // Status (already phrased by the shared engine)
  $("statusIcon").textContent = s.status.active ? "🛡" : "🕊";
  $("statusHeadline").textContent = s.status.headline;
  $("statusDetail").textContent = s.status.detail;
  $("statusFocus").textContent = s.focus.active
    ? `Focus session · ${s.focus.minutesLeft}m left`
    : "";

  // Focus controls
  const running = s.focus.active;
  $("focusLabel").textContent = running
    ? `Focusing — ${s.focus.minutesLeft} min left`
    : "No active session";
  show($("focusRow"), !running);
  show($("stopBtn"), running);

  // Websites — the real, enforced list
  const list = $("siteList");
  list.replaceChildren();
  if (!s.websites.length) {
    list.append(el("li", { className: "muted", textContent: "Nothing blocked" }));
  }
  for (const rule of s.websites) {
    const paused = rule.reasons?.reason === "temp-unblock";
    const active = rule.reasons && !paused;
    const li = el("li", {});
    li.append(el("span", { className: "grow", textContent: rule.target, title: rule.target }));
    if (active) li.append(el("span", { className: "tag on", textContent: "ON" }));
    else if (paused) li.append(el("span", { className: "tag off", textContent: "PAUSED" }));
    else li.append(el("span", { className: "tag ok", textContent: rule.whenLabel }));
    if (active) {
      const pause = el("button", {
        className: "chip ghost",
        textContent: `Pause ${s.settings.tempUnblockMinutes}m`,
        title: `Temporarily allow ${rule.target}`,
        onclick: async () => {
          await send({ type: "unblockRule", id: rule.id });
          await refresh();
        },
      });
      li.append(pause);
    }
    li.append(
      el("button", {
        className: "x",
        textContent: "✕",
        attrs: { "aria-label": `Remove ${rule.target}` },
        onclick: async () => {
          await send({ type: "removeSite", host: rule.target });
          await refresh();
        },
      })
    );
    list.append(li);
  }

  // Schedules
  const sl = $("schedList");
  sl.replaceChildren();
  if (!s.schedules.length) {
    sl.append(el("li", { className: "muted", textContent: "No schedules yet" }));
  }
  for (const sc of s.schedules) {
    const li = el("li", {});
    const name = el("span", { className: "grow" });
    name.append(el("span", { textContent: sc.name }));
    if (sc.running) name.append(el("span", { className: "tag ok", textContent: " RUNNING" }));
    li.append(name);
    li.append(
      el("span", {
        className: "muted",
        textContent: `${sc.start}–${sc.end}`,
      })
    );
    const toggle = el("button", {
      className: "chip ghost",
      textContent: sc.enabled ? "On" : "Off",
      title: `${sc.enabled ? "Disable" : "Enable"} ${sc.name}`,
      onclick: async () => {
        await send({ type: "setScheduleEnabled", id: sc.id, enabled: !sc.enabled });
        await refresh();
      },
    });
    li.append(toggle);
    li.append(
      el("button", {
        className: "x",
        textContent: "✕",
        attrs: { "aria-label": `Delete ${sc.name}` },
        onclick: async () => {
          await send({ type: "removeSchedule", id: sc.id });
          await refresh();
        },
      })
    );
    sl.append(li);
  }

  // Application rules — configured anywhere, enforced by the desktop client
  const al = $("appRuleList");
  al.replaceChildren();
  if (!s.appRules.length) {
    al.append(el("li", { className: "muted", textContent: "No application rules" }));
  }
  for (const rule of s.appRules) {
    const li = el("li", {});
    li.append(el("span", { className: "grow", textContent: rule.target, title: rule.target }));
    const active = rule.reasons;
    li.append(
      el("span", {
        className: `tag ${active ? "on" : "ok"}`,
        textContent: active ? "ON" : rule.whenLabel,
      })
    );
    al.append(li);
  }
  $("appRuleNote").textContent = s.appRules.length
    ? "A browser extension cannot close applications — the NORTH desktop app enforces these."
    : "Name applications in the web app; the desktop client enforces them.";

  // Usage
  const ul = $("usageList");
  ul.replaceChildren();
  if (!s.usageToday.length) {
    ul.append(el("li", { className: "muted", textContent: "No data yet — browsing time is tracked privately" }));
  }
  for (const { host, minutes } of s.usageToday) {
    const li = el("li", {});
    li.append(el("span", { className: "grow", textContent: host }));
    li.append(el("span", { className: "muted", textContent: `${minutes}m` }));
    ul.append(li);
  }

  // Account + honest scope note
  $("acctLabel").textContent = s.account ? s.account.un : "this device";
  show($("acctForm"), !s.account);
  show($("acctLinked"), Boolean(s.account));
  if (s.account) {
    $("acctNote").textContent =
      `Linked to ${s.account.un}. Rules stay on this device until account sync ships (SETUP.md).`;
  }
}

async function refresh() {
  const next = await send({ type: "getState" });
  snapshot = next;
  render();
}

// ── wiring ────────────────────────────────────────────────────────────────
document.querySelectorAll("#focusRow .chip").forEach((b) => {
  b.onclick = async () => {
    await send({ type: "startFocus", minutes: Number(b.dataset.min) });
    await refresh();
  };
});
$("stopBtn").onclick = async () => {
  await send({ type: "cancelFocus" });
  await refresh();
};

async function addSite() {
  const res = await send({ type: "addSite", host: $("siteInput").value });
  if (res?.ok) {
    $("siteInput").value = "";
    $("siteErr").classList.add("hide");
  } else {
    $("siteErr").textContent = res?.error || "Could not add that";
    $("siteErr").classList.remove("hide");
  }
  await refresh();
}
$("addBtn").onclick = addSite;
$("siteInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

// Schedule draft
const dayRow = $("schedDays");
function renderDays() {
  dayRow.replaceChildren();
  WEEKDAY_LABELS.forEach((lbl, i) => {
    const on = draftDays.includes(i);
    dayRow.append(
      el("button", {
        type: "button",
        textContent: lbl,
        attrs: { "aria-pressed": String(on), "aria-label": `${lbl}${on ? " on" : " off"}` },
        onclick: () => {
          draftDays = on ? draftDays.filter((d) => d !== i) : [...draftDays, i].sort((a, b) => a - b);
          renderDays();
        },
      })
    );
  });
}
renderDays();

$("schedToggle").onclick = () => {
  const open = $("schedForm").classList.contains("hide");
  show($("schedForm"), open);
  $("schedToggle").textContent = open ? "–" : "+";
};
$("schedCancel").onclick = () => {
  show($("schedForm"), false);
  $("schedToggle").textContent = "+";
};
$("schedAdd").onclick = async () => {
  const res = await send({
    type: "addSchedule",
    name: $("schedName").value || "Schedule",
    days: draftDays,
    start: $("schedStart").value,
    end: $("schedEnd").value,
  });
  if (res?.ok) {
    show($("schedForm"), false);
    $("schedErr").classList.add("hide");
    $("schedToggle").textContent = "+";
    $("schedName").value = "";
    await refresh();
  } else {
    $("schedErr").textContent = res?.error || "Could not add that schedule";
    $("schedErr").classList.remove("hide");
  }
};

// Account link
$("acctSave").onclick = async () => {
  const res = await send({ type: "linkAccount", un: $("acctInput").value });
  if (res?.ok) {
    $("acctInput").value = "";
    await refresh();
  } else {
    $("acctNote").textContent = res?.error || "Could not link that account";
  }
};
$("acctUnlink").onclick = async () => {
  await send({ type: "unlinkAccount" });
  await refresh();
};

refresh();
setInterval(refresh, 30000); // keep the countdown and the verdict honest while open
