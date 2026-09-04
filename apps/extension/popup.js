/**
 * Focusly popup — talks to the service worker over chrome.runtime messages.
 */
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

async function refresh() {
  const { blocked = [], focus = null, usageToday = [] } = await send({ type: "getState" });

  // Focus state
  $("stopBtn").hidden = !focus;
  if (focus) {
    const left = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 60000));
    $("focusLabel").textContent = `Focusing — ${left} min left`;
    $("focusRow").hidden = true;
  } else {
    $("focusLabel").textContent = "No active focus session";
    $("focusRow").hidden = false;
  }

  // Blocked sites
  $("siteList").innerHTML = "";
  for (const host of blocked) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const rm = document.createElement("button");
    rm.className = "x";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", `Unblock ${host}`);
    rm.onclick = async () => { await send({ type: "removeBlocked", host }); refresh(); };
    li.append(name, rm);
    $("siteList").appendChild(li);
  }
  if (!blocked.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Nothing blocked";
    $("siteList").appendChild(li);
  }

  // Usage
  $("usageList").innerHTML = "";
  if (!usageToday.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No data yet — browsing time is tracked privately";
    $("usageList").appendChild(li);
  } else {
    for (const { host, minutes } of usageToday) {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.textContent = host;
      const m = document.createElement("span");
      m.className = "muted";
      m.textContent = `${minutes}m`;
      li.append(n, m);
      $("usageList").appendChild(li);
    }
  }
}

document.querySelectorAll("#focusRow .chip").forEach((b) => {
  b.onclick = async () => { await send({ type: "startFocus", minutes: Number(b.dataset.min) }); refresh(); };
});
$("stopBtn").onclick = async () => { await send({ type: "cancelFocus" }); refresh(); };
$("addBtn").onclick = async () => {
  const host = $("siteInput").value;
  const r = await send({ type: "addBlocked", host });
  if (r?.ok) { $("siteInput").value = ""; refresh(); }
};
$("siteInput").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") $("addBtn").click();
});

refresh();
setInterval(refresh, 30000); // keep the countdown honest while open
