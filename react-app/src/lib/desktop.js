import { normalizeState, defaultBlocking } from "../shared/blocking.js";
import { readUsageHistory, mergeUsageSources } from "./usage-history.js";

export const isDesktop = () => Boolean(globalThis.__TAURI__?.core?.invoke);
const invoke = (command, args) => globalThis.__TAURI__.core.invoke(command, args);
let queue = Promise.resolve();
const serial = (task) => { queue = queue.catch(() => {}).then(task); return queue; };
let generation = 0;
let manualRefresh = null;
export async function refreshDesktopSync() {
  if (!isDesktop()) return;
  if (!manualRefresh) throw new Error('Desktop sync is not ready. Sign in again and retry.');
  await manualRefresh();
}
const USAGE_DEVICE_KEY = "northUsageDeviceId";
const newUsageDeviceId = () => globalThis.crypto?.randomUUID?.() || `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function readDesktopUsage(owner) {
  return isDesktop() && owner ? invoke("desktop_usage", { owner }) : [];
}

export async function applyDesktopBlocking(blocking) {
  if (!isDesktop()) return;
  const state = normalizeState(blocking || defaultBlocking());
  return invoke("apply_account_blocking", {
    rules: state.rules, schedules: state.schedules, usageLimits: state.usageLimits,
    settings: state.settings, focus: state.focus,
  });
}

// All native account transitions run in order. A late response from the old
// account cannot replace the new account's enforcer or upload its usage.
export function startDesktopBridge({ user, client, store, sync }) {
  if (!isDesktop()) return () => {};
  const current = ++generation;
  let busy = false;
  let lastCloud = 0;
  let deviceId = null;
  const tick = (force = false) => serial(async () => {
    if (generation !== current || busy) return;
    busy = true;
    try {
      const { data } = client ? await client.auth.getSession() : { data: {} };
      const owner = data?.session?.user?.id;
      if (!owner || owner !== user?.id) {
        await invoke("set_usage_owner", { owner: null });
        await applyDesktopBlocking(defaultBlocking());
        if (force === true) throw new Error('Sign in to refresh this desktop account.');
        return;
      }
      await invoke("set_usage_owner", { owner });
      if (force === true || Date.now() - lastCloud > 30000) {
        const pushed = await sync.flush("desktop");
        const pulled = pushed?.ok && await sync.pull();
        if (force === true && !pulled) throw new Error('Account sync could not finish. Your changes remain saved locally.');
      }
      if (generation !== current) return;
      const profile = await store.get(`u:${user.un}`);
      await applyDesktopBlocking(profile?.blocking);
      if (force === true || Date.now() - lastCloud > 30000) {
        const rows = await readDesktopUsage(owner);
        if (generation !== current) return;
        if (rows.length) {
          deviceId ||= await store.get(USAGE_DEVICE_KEY);
          if (!deviceId) {
            deviceId = newUsageDeviceId();
            await store.set(USAGE_DEVICE_KEY, deviceId);
          }
          const payload = rows.map((row) => ({ ...row, user_id: owner, kind: "app", device_id: deviceId, source: "desktop" }));
          let { error } = await client.from("usage_records").upsert(payload, { onConflict: "user_id,day,kind,name,device_id" });
          // The migration is additive; keep existing deployments working until
          // their administrator applies it, without hiding other failures.
          if (error && /device_id|source|column|constraint/i.test(error.message || "")) {
            ({ error } = await client.from("usage_records").upsert(rows.map((row) => ({ ...row, user_id: owner, kind: "app" })), { onConflict: "user_id,day,kind,name" }));
          }
          if (error) throw error;
        }
        if (deviceId) {
          const day = new Date().toISOString().slice(0, 10);
          const cloud = await readUsageHistory(client, owner, day, day);
          if (generation !== current) return;
          const otherDevices = mergeUsageSources(cloud.filter((row) => row.kind === "app" && row.device_id && row.device_id !== "legacy" && row.device_id !== deviceId));
          await invoke("set_remote_usage", { owner, day, usage: Object.fromEntries(otherDevices.map((row) => [row.name, row.seconds])) });
        }
        lastCloud = Date.now();
      }
    } catch (error) {
      // Native rules and usage remain persisted when the service is offline.
      console.debug("[north desktop] sync deferred:", error?.message || "unavailable");
      if (force === true) throw error;
    } finally { busy = false; }
  });
  const refreshNow = () => tick(true);
  manualRefresh = refreshNow;
  tick();
  const timer = setInterval(tick, 10000);
  let disposed = false;
  let unlisten;
  if (globalThis.__TAURI__.event?.listen) {
    globalThis.__TAURI__.event.listen("north-desktop-tick", tick).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
  }
  const reconnect = () => { lastCloud = 0; tick(); };
  window.addEventListener("online", reconnect);
  window.addEventListener("north:refresh-sync", reconnect);
  return () => {
    if (manualRefresh === refreshNow) manualRefresh = null;
    disposed = true;
    unlisten?.();
    clearInterval(timer);
    window.removeEventListener("online", reconnect);
    window.removeEventListener("north:refresh-sync", reconnect);
    if (generation === current) generation++;
    serial(async () => {
      await invoke("set_usage_owner", { owner: null });
      await applyDesktopBlocking(defaultBlocking());
    });
  };
}
