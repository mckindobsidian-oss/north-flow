/**
 * NORTH popup — a thin view over the service worker's snapshot.
 *
 * The popup deliberately does NOT evaluate blocking itself: it calls the worker
 * (`getState`), and the worker runs the same shared engine every other client
 * runs. One verdict, one implementation. User text always goes in through
 * textContent, so a hostname can never be interpreted as markup.
 */
import { WEEKDAY_LABELS, WORKDAYS } from "./lib/blocking.js";
import { encodeReason, scheduleNames, describeBlock } from "./lib/block-reason.js";
import { applyTheme } from "./lib/appearance.js";
import { NORTH_WEB_ORIGINS } from "./lib/external.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

/** New-schedule draft, kept in the popup until the worker accepts it. */
let draftDays = [...WORKDAYS];
let snapshot = null;
let usageRange = null;

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
const usageLabel = (seconds) => seconds < 60 ? `${seconds}s` : seconds < 3600
  ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
const dayKey = (offset = 0) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

function renderUsage(rows, from, to) {
  const list = Array.isArray(rows) ? rows : [];
  const ul = $("usageList");
  ul.replaceChildren();
  const totalSeconds = list.reduce((sum, row) => sum + (Number(row.seconds) || 0), 0);
  const maxSeconds = Math.max(1, ...list.map((row) => Number(row.seconds) || 0));
  $("usageTotal").textContent = usageLabel(totalSeconds);
  $("usageCount").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
  $("usageNote").textContent = list.length
    ? `Activity · ${from === to ? from : `${from} to ${to}`}`
    : `No activity recorded for ${from === to ? from : "this date range"}`;
  if (!list.length) ul.append(el("li", { className: "muted", textContent: "No browsing recorded for this period" }));
  for (const { host, seconds, kind } of list) {
    const li = el("li", { className: "usage-row" });
    li.append(el("span", { className: "grow", textContent: `${host}${kind === "app" ? " · app" : ""}` }));
    const bar = el("span", { className: "usage-bar" });
    bar.append(el("i", { style: { width: `${Math.max(3, Math.round((Number(seconds) || 0) / maxSeconds * 100))}%` } }));
    li.append(bar, el("span", { className: "muted", textContent: usageLabel(seconds) }));
    ul.append(li);
  }
}

async function refreshUsageRange() {
  const from = $("usageFrom").value || dayKey();
  const to = $("usageTo").value || from;
  const result = await send({ type: "getUsageRange", from, to });
  if (result?.ok) { usageRange = result; render(); }
}

// ── render ────────────────────────────────────────────────────────────────
function render() {
  const s = snapshot;
  if (!s) return;
  applyTheme(s.theme, s.appearance);

  // Status (already phrased by the shared engine)
  $("statusIcon").textContent = s.status.active ? "●" : "○";
  $("statusHeadline").textContent = s.status.headline;
  $("statusDetail").textContent = s.status.detail;
  $("statusFocus").textContent = s.focus.active
    ? `Focus session active · ${s.focus.minutesLeft} min remaining`
    : "";

  // The page in front of the person: is it blocked, and by what? The reason
  // wording comes from the same module the block page uses, so the two can
  // never describe the same rule differently.
  const cur = s.current;
  $("currentHost").textContent = cur ? cur.host : "";
  if (!cur) {
    $("currentState").textContent = "No active website";
    $("currentState").style.color = "";
  } else if (cur.blocked) {
    const why = describeBlock({
      code: encodeReason(cur.reason),
      domain: cur.host,
      names: scheduleNames(cur.reason),
      minutesLeft: s.focus.minutesLeft,
    });
    $("currentState").textContent = `Blocked · ${why.badge}`;
    $("currentState").style.color = why.tone === "focus" ? "#007aff" : "#ff3b30";
  } else {
    $("currentState").textContent = "Allowed";
    $("currentState").style.color = "#34c759";
  }
  const canPause = Boolean(cur?.blocked && cur.ruleId && !cur.paused && s.settings.allowTemporaryUnblock);
  show($("currentPauseRow"), canPause);
  if (canPause) {
    $("currentPause").textContent = `Pause ${s.settings.tempUnblockMinutes}m`;
    $("currentPause").onclick = async () => {
      await send({ type: "unblockRule", id: cur.ruleId });
      await refresh();
    };
  }

  // Focus controls
  const running = s.focus.active;
    $("focusLabel").textContent = running
    ? `Focus session · ${s.focus.minutesLeft} min remaining`
    : "No focus session is running";
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
    if (active) li.append(el("span", { className: "tag on", textContent: "BLOCKING" }));
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

  const limitList = $("limitList");
  limitList.replaceChildren();
  const limits = [...s.usageLimits, ...s.websites.map((rule) => ({ ...rule, rule: true })), ...s.appRules.map((rule) => ({ ...rule, rule: true }))];
  if (!limits.length) limitList.append(el("li", { className: "muted", textContent: "No limits yet. Create one in North Flow." }));
  for (const limit of limits) {
    const li = el("li", { className: "limit-row" });
    const info = el("div", { className: "limit-copy" });
    info.append(el("strong", { textContent: limit.name || limit.label || limit.target }));
    const allowance = limit.rule
      ? limit.when === "scheduled" ? "Scheduled block" : limit.when === "focus" ? "During focus" : "Always blocked"
      : limit.mode === "session" ? limit.kind === "app" ? `${usageLabel(limit.dailyLimitMinutes * 60)} per session` : "Allowance chosen per visit" : `${usageLabel(limit.dailyLimitMinutes * 60)} per day`;
    info.append(el("small", { textContent: `${limit.target} · ${allowance}` }));
    if (limit.rule && limit.when === "scheduled") {
      const schedules = s.schedules.filter((schedule) => !limit.scheduleIds?.length || limit.scheduleIds.includes(schedule.id));
      for (const schedule of schedules) info.append(el("small", { textContent: `${schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ")} · ${schedule.start}–${schedule.end}` }));
    }
    if (!limit.rule && limit.mode === "daily" && Number.isFinite(limit.usedSeconds)) {
      info.append(el("small", { textContent: `${usageLabel(limit.usedSeconds)} used · ${usageLabel(Math.max(0, limit.dailyLimitMinutes * 60 - limit.usedSeconds))} remaining` }));
    }
    const status = !limit.enabled ? "Paused" : limit.kind === "app" ? "Desktop" : limit.reached || limit.reasons ? "Blocked" : "Active";
    li.append(info, el("span", { className: `tag ${status === "Blocked" ? "on" : "ok"}`, textContent: status }));
    limitList.append(li);
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
  const choices = $("visitedSites");
  choices.replaceChildren(...s.usageToday.map(({ host }) => el("option", { value: host })));
  if (!$("usageFrom").value) $("usageFrom").value = dayKey();
  if (!$("usageTo").value) $("usageTo").value = dayKey();
  if (usageRange) renderUsage(usageRange.usage, usageRange.from, usageRange.to);
  else renderUsage((s.activityToday || s.usageToday).filter((row) => !row.kind || row.kind === "website"), dayKey(), dayKey());
  const desktopRows = s.desktopUsageToday || [];
  $("desktopUsageList").replaceChildren(...desktopRows.map((row) => el("li", { className: "usage-row" }, [
    el("span", { className: "grow", textContent: row.name }),
    el("span", { className: "muted", textContent: usageLabel(row.seconds) }),
  ])));
  $("desktopUsageNote").textContent = desktopRows.length
    ? "Synced from North Desktop"
    : "No desktop activity synced today";
  $("audioTracking").checked = Boolean(s.trackBackgroundAudio);
  const week = usageRange?.chart || s.usageHourly || s.usageWeek || [];
  const maxDay = Math.max(1, ...week.map((day) => day.seconds));
  const graph = $("usageWeekGraph");
  graph.replaceChildren();
  graph.setAttribute("aria-label", `Activity: ${week.map((day) => `${day.label} ${usageLabel(day.seconds)}`).join(", ")}`);
  for (const [index, day] of week.entries()) {
    const col = document.createElement("div");
    col.title = `${day.day}: ${Math.round(day.seconds / 60)}m`;
    col.style.cssText = "flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px";
    const bar = document.createElement("span");
    bar.style.cssText = `display:block;width:70%;height:${day.seconds ? Math.max(4, day.seconds / maxDay * 37) : 2}px;border-radius:5px;background:${day.day === new Date().toISOString().slice(0, 10) ? "var(--accent)" : "rgba(255,255,255,.45)"}`;
    const label = document.createElement("span");
    label.className = "muted";
    label.style.fontSize = "9px";
    label.textContent = index % Math.max(1, Math.ceil(week.length / 6)) === 0 ? day.label : "";
    col.append(bar, label);
    graph.append(col);
  }

  // Account + honest scope note
  const authed = Boolean(s.account?.authUserId);
  $("acctLabel").textContent = authed ? s.account.un : "Not linked";
  $("acctMode").textContent = authed ? "Connected" : "";
  show($("acctForm"), !authed);
  show($("acctLinked"), authed);
  if (authed) $("acctNote").textContent = s.lastSync
    ? `Connected as ${s.account.un} · last successful sync ${new Date(s.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
    : `Connected as ${s.account.un} · waiting for the first successful sync.`;
  $("limitsSyncStatus").textContent = !authed ? "This browser only" : s.lastSync ? "Account synced" : "Sync pending";

  // Version + last reconciliation, so "is it actually syncing?" has an answer
  // that isn't a guess.
  $("aboutLine").textContent = s.lastSync
    ? `v${s.version} · last synced ${new Date(s.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `v${s.version} · not synced to an account yet`;
}

async function refresh() {
  const next = await send({ type: "getState" });
  snapshot = next;
  render();
  send({ type: 'focusRank' }).then(result => {
    const rank = result?.mine;
    $("focusRank").textContent = rank ? `Global focus rank #${rank.rank} · ${Math.floor(Number(rank.focus_minutes) / 60)}h ${Number(rank.focus_minutes) % 60}m focused` : 'Global focus ranking available when connected to your account.';
    if (result?.ok && result.rows?.length) {
      $("focusRank").style.whiteSpace = 'pre-line';
      const leaders = result.rows.filter(row => Number(row.rank) <= 3).map(row => `#${row.rank} ${row.name || row.un} · ${Number(row.focus_minutes)}m`).join('\n');
      $("focusRank").append(document.createTextNode(`\n\nGlobal leaders\n${leaders}`));
    }
  }).catch(() => { $("focusRank").textContent = 'Global ranking temporarily unavailable.'; });
}

// ── wiring ────────────────────────────────────────────────────────────────
$("refreshNorth").onclick = async () => {
  const button = $("refreshNorth"); button.disabled = true; button.textContent = "Syncing…";
  try {
    const result = await send({ type: "syncAccount" });
    if (!result?.ok) throw new Error(result?.error || result?.reason || "Account sync unavailable");
    location.reload();
  } catch (error) { button.disabled = false; button.textContent = "↻ Refresh sync"; $("aboutLine").textContent = `Refresh failed: ${error.message}`; }
};
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

const showPopupTab = (tab) => {
  const stats = tab === "stats";
  $("statsPane").classList.toggle("hide", !stats);
  $("limitsPane").classList.toggle("hide", stats);
  $("statsTab").setAttribute("aria-selected", String(stats));
  $("limitsTab").setAttribute("aria-selected", String(!stats));
};
$("statsTab").onclick = () => showPopupTab("stats");
$("limitsTab").onclick = () => showPopupTab("limits");
$("audioTracking").onchange = async (event) => {
  const result = await send({ type: "setBackgroundAudio", enabled: event.target.checked });
  if (!result?.ok) event.target.checked = !event.target.checked;
  await refresh();
};
$("usageFrom").onchange = refreshUsageRange;
$("usageTo").onchange = refreshUsageRange;
$("usageToday").onclick = () => { $("usageFrom").value = dayKey(); $("usageTo").value = dayKey(); usageRange = null; refreshUsageRange(); };
$("usageYesterday").onclick = () => { $("usageFrom").value = dayKey(-1); $("usageTo").value = dayKey(-1); refreshUsageRange(); };
$("clearUsage").onclick = async () => {
  if (!window.confirm("Permanently clear website usage history and blocked-attempt counts stored by NORTH on this browser?")) return;
  const result = await send({ type: "clearUsageHistory" });
  if (!result?.ok) return;
  usageRange = null;
  $("usageFrom").value = dayKey();
  $("usageTo").value = dayKey();
  await refresh();
  await refreshUsageRange();
};
$("addBtn").onclick = addSite;
$("siteInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

async function addUsageLimit() {
  const result = await send({ type: "addUsageLimit", host: $("limitInput").value, mode: $("limitMode").value,
    minutes: Number($("limitAmount").value), name: $("limitName").value });
  if (result?.ok) {
    $("limitInput").value = "";
    $("limitName").value = "";
    $("limitErr").classList.add("hide");
  } else {
    $("limitErr").textContent = result?.error || "Could not add that limit";
    $("limitErr").classList.remove("hide");
  }
  await refresh();
}
$("addLimitBtn").onclick = addUsageLimit;
$("limitInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addUsageLimit(); });
$("limitMode").onchange = () => { $("limitAmount").classList.toggle("hide", $("limitMode").value === "session"); };

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

$("acctSignOut").onclick = async () => {
  await send({ type: "authSignOut" });
  await refresh();
};
async function openNorthFlow({ connect = false } = {}) {
  const { northWebUrl } = await chrome.storage.local.get("northWebUrl");
  const tabs = connect ? await chrome.tabs.query({}) : [];
  const current = connect ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  const pageOrigin = (url) => {
    try {
      const origin = new URL(url || "").origin;
      return NORTH_WEB_ORIGINS.includes(origin) ? origin : "";
    } catch { return ""; }
  };
  const activeOrigin = pageOrigin(current[0]?.url);
  const openNorthTab = [...tabs].filter((tab) => pageOrigin(tab.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const dashboard = new URL(activeOrigin || pageOrigin(openNorthTab?.url) || pageOrigin(northWebUrl) || "http://localhost:5174");
  dashboard.searchParams.set("tab", "flow");
  if (connect) {
    const nonce = crypto.randomUUID();
    await chrome.storage.local.set({ northConnectPending: { nonce, expiresAt: Date.now() + 5 * 60 * 1000, origin: dashboard.origin } });
    dashboard.searchParams.set("connectExtension", chrome.runtime.id);
    dashboard.searchParams.set("connectNonce", nonce);
  }
  chrome.tabs.create({ url: dashboard.toString() });
}
$("acctConnect").onclick = async () => {
  await openNorthFlow({ connect: true });
  window.close();
};
$("openNorth").onclick = async () => {
  await openNorthFlow();
  window.close();
};

refresh();
setInterval(refresh, 30000); // keep the countdown and the verdict honest while open
