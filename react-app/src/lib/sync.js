/**
 * NORTH — the backend the clients actually talk to.
 *
 * Until now the web app was honest but device-local: Supabase handled sign-in,
 * and everything the user created (tasks, boards, focus sessions, block rules)
 * lived in `localStorage`. The database in `supabase/schema.sql` was applied and
 * waiting, but nothing wrote to it. This module is the missing half.
 *
 * HOW IT SITS IN THE APP
 * The app already has exactly one storage boundary — the `S.*` object in
 * `focusly.jsx` — and every screen goes through it. So nothing in the UI
 * changes: `S.*` keeps its API, gains a remote mirror, and this file implements
 * the translation between the app's shapes and the tables. The pure half of
 * that translation lives in `sync-map.js`, so it can be unit-tested without a
 * browser or a database.
 *
 * WHY LOCAL STILL COMES FIRST
 * Reads are served from the device cache, so the timer, the kanban board and
 * the calendar never wait on a network round-trip and keep working with no
 * connection at all. Writes hit the cache immediately and are then queued to
 * Postgres. That queue is persisted (`north:syncq`), so a session recorded on a
 * plane is pushed the next time the app opens — a completed focus session is
 * never lost to a failed request (ARCHITECTURE.md §4).
 *
 * RECONCILIATION, STATED PLAINLY
 * The first time a device links to an account its local record is pushed up (so
 * nothing the user already had is discarded), and the server's rows are then
 * pulled down. After that the server is authoritative and every screen reads
 * the pulled copy. Conflicts are whole-record, last-write-wins — which is what
 * one person using several devices actually needs, and simple enough to reason
 * about.
 *
 * WHAT IS DELIBERATELY DEVICE-LOCAL
 * Temporary unblocks and the running focus window are *ephemeral* — an expiry
 * and a countdown. Syncing them would mean one device pausing another's
 * enforcement for a reason that no longer exists. Each client evaluates its own
 * copy from the rules, which ARE shared. The focus *sessions* those windows
 * produce are synced, because they are permanent records.
 */

import { normalizeState, defaultBlocking } from "../shared/blocking.js";
import {
  boardToRow, docFromProfile, isUuid, keepLocalTaskMeta, profileFromRows, pushable,
  rowToBoard, rowToSession, sessionToRow, signature, taskToRow,
} from "./sync-map.js";

const QUEUE_KEY = "north:syncq"; // pending storage keys, awaiting a push
const HISTORY_DAYS = 183; // 26 weeks + margin — must cover the full activity heatmap

/**
 * Did this write fail because the project has not applied a migration yet?
 *
 * Two DIFFERENT PostgREST diagnostics mean the same thing here, and the
 * difference is not cosmetic — an earlier version checked only the first and
 * so silently missed every payload case:
 *
 *   42703     "column tasks.difficulty does not exist"
 *             raised by Postgres when the missing column is REFERENCED (a
 *             select, a filter, an order).
 *   PGRST204  "Could not find the 'description' column of 'tasks' in the
 *             schema cache"
 *             raised by PostgREST when the missing column is in a WRITE
 *             PAYLOAD — which is exactly the upsert shape both callers below
 *             use. Verified against the live project: an upsert carrying an
 *             unknown column answers PGRST204, not 42703.
 *
 * Matching both means a half-migrated project degrades (the new fields stay
 * local) instead of losing every task it tries to push.
 */
const isMissingColumn = (e) =>
  Boolean(e) && (e.code === "42703" || e.code === "PGRST204" ||
    /column .* does not exist/i.test(e.message || "") ||
    /could not find the .* column/i.test(e.message || ""));

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Re-exported so callers have one import site for the backend.
export { isUuid, signature } from "./sync-map.js";
export { newUuid } from "./sync-map.js";

/**
 * PLATFORM NEUTRAL ON PURPOSE. This module must load anywhere the NORTH
 * engine runs — the browser, Node (tests) and React Native (apps/mobile/lib).
 * It therefore imports NO client and touches NO browser global: the Supabase
 * client arrives as an argument, and every read/write goes through the
 * injected `store` (the host's `S.*` boundary — localStorage on web,
 * AsyncStorage on the phone). `react-app/src/lib/supabase.js` is Vite-only
 * (`import.meta.env`) and used to be imported here, which made this engine
 * unloadable by Metro; it is now the *caller's* concern.
 *
 * @param {object} opts
 * @param {object} opts.store       the host's local `S.*` boundary (cache + queue host)
 * @param {object} [opts.client]    Supabase client (null when accounts are unavailable)
 * @param {boolean} [opts.configured] whether a real backend is available
 */
export function createSync({ store, client = null, configured = Boolean(client) }) {
  let userId = null;         // auth uid — the identity every table is scoped to
  let un = null;             // the device-stable username key
  let applying = false;      // true while pulling, so pulls never echo back as writes
  let timer = null;
  let running = null;        // in-flight flush, so concurrent calls collapse
  const skipped = new Set(); // non-uuid legacy ids already reported
  const pushed = new Map();  // key → fingerprint of the last successful push

  const ready = () => Boolean(configured && client && userId);
  const log = (...a) => { try { console.warn("[north sync]", ...a); } catch { /* no console */ } };

  // ── pending queue (persisted, so an offline write is never lost) ────────
  // Persisted through the injected store rather than `localStorage` directly:
  // the same record then survives a restart on the web (localStorage) and on
  // the phone (AsyncStorage) with no platform branch here. The queue key is
  // not `pushable`, so writing it never re-enqueues itself.
  async function readQueue() {
    try {
      const list = await store.get(QUEUE_KEY);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  async function writeQueue(list) {
    try {
      const uniq = [...new Set(list)];
      if (!uniq.length) await store.del(QUEUE_KEY);
      else await store.set(QUEUE_KEY, uniq);
    } catch { /* no storage — the push simply is not retried */ }
  }
  async function enqueue(key) {
    const q = await readQueue();
    if (!q.includes(key)) await writeQueue([...q, key]);
  }

  // ── pushes ──────────────────────────────────────────────────────────────
  async function pushProfileRow(profile) {
    const doc = docFromProfile(profile);
    const base = {
      id: userId,
      name: doc.name || un,
      email: doc.email || null,
      settings: {
        pm: doc.pm,
        // Schema-shaped copies of the blocking settings, alongside the complete
        // client document, so neither direction loses information.
        blockDuringFocus: doc.blocking.settings.blockDuringFocus,
        allowTemporaryUnblock: doc.blocking.settings.allowTemporaryUnblock,
        tempUnblockMinutes: doc.blocking.settings.tempUnblockMinutes,
        apps: doc.apps,
        hiddenUsageSites: doc.hiddenUsageSites,
        blocking: doc.blocking,
        // Account theme. Sent only when the profile carries one, so a push
        // never manufactures a default and overwrite the cloud value with it.
        ...(doc.theme ? { theme: doc.theme } : {}),
      },
    };
    // `un` carries a unique constraint. Send it first so the leaderboard and
    // every other client agree on who this is; if somebody else already holds
    // that name, fall back to leaving the row's existing value alone.
    const first = await client.from("profiles").upsert({ ...base, un }, { onConflict: "id" });
    if (!first.error) return true;
    if (first.error.code === "23505" || /duplicate key/i.test(first.error.message || "")) {
      const second = await client.from("profiles").upsert(base, { onConflict: "id" });
      if (!second.error) return true;
      log("profile push failed:", second.error.message);
      return false;
    }
    log("profile push failed:", first.error.message);
    return false;
  }

  /** Boards first — tasks hold a foreign key to them. */
  async function pushBoards(username) {
    const boards = (await store.get(`bd:${username}`)) || [];
    const rows = boards.filter((b) => isUuid(b.id)).map((b, i) => boardToRow(b, userId, i));
    if (rows.length) {
      const { error } = await client.from("boards").upsert(rows, { onConflict: "id" });
      if (error) { log("board push failed:", error.message); return false; }
    }
    const ids = rows.map((r) => r.id);
    let del = client.from("boards").delete().eq("user_id", userId);
    if (ids.length) del = del.not("id", "in", `(${ids.join(",")})`);
    const { error: delErr } = await del;
    if (delErr) log("board prune failed:", delErr.message);
    return true;
  }

  async function pushTasks(profile) {
    const tasks = (profile.tasks || []).filter((t) => {
      if (isUuid(t.id)) return true;
      if (!skipped.has(t.id)) {
        skipped.add(t.id);
        log(`task "${t.title}" has a pre-uuid id (${t.id}) — it stays on this device; re-create it to sync.`);
      }
      return false;
    });
    const rows = tasks.map((t, i) => taskToRow(t, userId, i));
    if (rows.length) {
      let { error } = await client.from("tasks").upsert(rows, { onConflict: "id" });
      // The difficulty + description columns arrive with migration 005. A
      // project that has not applied it rejects those two fields, so strip them
      // and retry once: every other task field still syncs and the two extras
      // stay on this device, which is exactly how they behaved before the
      // columns existed. One metadata column must never cost the whole task.
      if (isMissingColumn(error)) {
        // Deliberately NOT rest-destructuring to drop the keys: listing what to
        // keep would silently discard any column added later, and naming the
        // dropped keys only to discard them is an unused binding. Copy and
        // delete exactly what the schema is missing.
        const bare = rows.map((r) => { const c = { ...r }; delete c.difficulty; delete c.description; return c; });
        ({ error } = await client.from("tasks").upsert(bare, { onConflict: "id" }));
      }
      if (error) { log("task push failed:", error.message); return false; }
    }
    const ids = rows.map((r) => r.id);
    let del = client.from("tasks").delete().eq("user_id", userId);
    if (ids.length) del = del.not("id", "in", `(${ids.join(",")})`);
    const { error: delErr } = await del;
    if (delErr) log("task prune failed:", delErr.message);
    return true;
  }

  /** Friendships are usernames; the leaderboard validates that they exist. */
  async function pushFriends(profile) {
    const friends = (profile.friends || []).map((friend_un) => ({
      user_id: userId, friend_un, status: "accepted",
    }));
    if (friends.length) {
      const { error } = await client.from("friends").upsert(friends, { onConflict: "user_id,friend_un" });
      if (error) { log("friend push failed:", error.message); return false; }
    }
    const names = friends.map((f) => f.friend_un);
    let del = client.from("friends").delete().eq("user_id", userId);
    if (names.length) del = del.not("friend_un", "in", `(${names.join(",")})`);
    const { error: delErr } = await del;
    if (delErr) { log("friend prune failed:", delErr.message); return false; }
    return true;
  }

  /**
   * Mirror the rules/schedules into their own tables. The jsonb document above
   * stays what clients read back (it keeps the client-side ids that rules and
   * schedules reference each other by); these rows are the normalised copy, so
   * usage and enforcement can be reported and joined server-side.
   */
  async function pushBlockingMirror(profile) {
    const b = normalizeState(profile.blocking || defaultBlocking());

    // Rebuilt wholesale, in the one order the foreign keys allow: clear last
    // time's rows, insert the schedules (which get their own uuid ids), then
    // insert the rules pointing at those ids. Both sets are small — a person
    // has a handful of rules — so a full replace is cheaper to get right than a
    // diff, and it cannot leave an orphaned rule behind.
    await client.from("block_rules").delete().eq("user_id", userId);
    await client.from("block_schedules").delete().eq("user_id", userId);

    let scheduleIdByName = new Map();
    if (b.schedules.length) {
      const { data: inserted, error: scErr } = await client
        .from("block_schedules")
        .insert(b.schedules.map((s) => ({
          user_id: userId,
          name: s.name,
          days: (s.days || []).filter((d) => d >= 0 && d <= 6),
          start_time: s.start,
          end_time: s.end,
          enabled: Boolean(s.enabled),
        })))
        .select("id, name");
      if (scErr) { log("schedule mirror failed:", scErr.message); return; }
      scheduleIdByName = new Map((inserted || []).map((r) => [r.name, r.id]));
    }

    if (!b.rules.length) return;
    const rules = b.rules.map((r) => ({
      user_id: userId,
      kind: r.kind,
      target: r.target,
      label: r.label || "",
      enabled: Boolean(r.enabled),
      when: r.when,
      schedule_ids: (r.scheduleIds || [])
        .map((id) => {
          const s = b.schedules.find((x) => x.id === id);
          return s ? scheduleIdByName.get(s.name) : null;
        })
        .filter(Boolean),
    }));
    const { error: rErr } = await client.from("block_rules").insert(rules);
    if (rErr) log("rule mirror failed:", rErr.message);
  }

  async function pushSessions(key) {
    const sessions = (await store.get(key)) || [];
    const rows = sessions.filter((s) => isUuid(s.id)).map((s) => sessionToRow(s, userId));
    if (!rows.length) return true;
    // Insert-only (ignoreDuplicates): a session is an event and is never
    // rewritten. `daily_focus` is then rolled up by the database trigger, so
    // the totals that feed the leaderboard cannot be forged by a client.
    let { error } = await client.from("focus_sessions").upsert(rows, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    // The task_id column arrives with a migration; a project that has not
    // applied it yet rejects the unknown column (42703). Strip the field and
    // retry once — sessions still push, just unlinked, exactly as before the
    // field existed. No behavior depends on the link being present.
    if (isMissingColumn(error)) {
      const bare = rows.map((r) => { const c = { ...r }; delete c.task_id; return c; });
      ({ error } = await client.from("focus_sessions").upsert(bare, { onConflict: "id", ignoreDuplicates: true }));
    }
    if (error) { log(`focus session push failed (${key}):`, error.message); return false; }
    return true;
  }

  async function pushOne(key) {
    if (key.startsWith("u:")) {
      const profile = await store.get(key);
      if (!profile || profile.un !== un) return true; // another account's record
      const sig = signature(key, profile);
      if (pushed.get(key) === sig) return true; // nothing shareable changed
      const boardsOk = await pushBoards(un); // tasks reference these
      const profileOk = await pushProfileRow(profile);
      const tasksOk = await pushTasks(profile);
      const friendsOk = await pushFriends(profile);
      await pushBlockingMirror(profile);
      const ok = boardsOk && profileOk && tasksOk && friendsOk;
      // Keep failed profile writes queued. Marking the signature here even on
      // error caused the retry to be treated as a no-op and dropped, including
      // edits to the account-owned website limits in profiles.settings.
      if (ok) pushed.set(key, sig);
      return ok;
    }
    if (key.startsWith("bd:")) {
      if (key !== `bd:${un}`) return true;
      const sig = signature(key, await store.get(key));
      if (pushed.get(key) === sig) return true;
      const ok = await pushBoards(un);
      if (ok) pushed.set(key, sig);
      return ok;
    }
    if (key.startsWith("fs:")) {
      const sig = signature(key, await store.get(key));
      if (pushed.get(key) === sig) return true;
      const ok = await pushSessions(key);
      if (ok) pushed.set(key, sig);
      return ok;
    }
    return true;
  }

  /** Push everything this device is holding. Safe to call at any time. */
  async function flush(reason = "auto") {
    if (!ready()) return { ok: false, reason: "not signed in" };
    if (running) return running;
    running = (async () => {
      const keys = await readQueue();
      const failed = [];
      for (const key of keys) {
        try {
          const ok = await pushOne(key);
          if (!ok) failed.push(key);
        } catch (err) {
          failed.push(key);
          log(`push threw for ${key}:`, err?.message || err);
        }
      }
      await writeQueue(failed);
      if (failed.length) log(`${failed.length} change(s) still pending — will retry (${reason}).`);
      return { ok: failed.length === 0, pending: failed.length };
    })().finally(() => { running = null; });
    return running;
  }

  async function flushProfile(username = un) {
    if (!ready() || !username || username !== un) return { ok: false, reason: "not signed in" };
    await enqueue(`u:${username}`);
    if (running) await running;
    return flush("profile preference");
  }

  // ── pull ────────────────────────────────────────────────────────────────
  /**
   * Pull the account's rows into the device cache. Returns false when the
   * account has no row yet (a brand-new sign-up), so the caller knows to push
   * the device record up instead.
   */
  async function pull(username = un) {
    if (!ready()) return false;
    const key = username || un;
    applying = true;
    try {
      const since = ymd(new Date(Date.now() - HISTORY_DAYS * 86400000));
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      const [profileRes, boardRes, taskRes, friendRes, dailyRes, sessionRes] = await Promise.all([
        client.from("profiles").select("id, un, name, email, created_at, settings").eq("id", userId).maybeSingle(),
        client.from("boards").select("id, name, position").eq("user_id", userId).order("position"),
        client.from("tasks").select("*").eq("user_id", userId).order("position"),
        client.from("friends").select("friend_un").eq("user_id", userId),
        client.from("daily_focus").select("day, focus_s").eq("user_id", userId).gte("day", since),
        client.from("focus_sessions").select("*").eq("user_id", userId).gte("started_at", midnight.toISOString()),
      ]);

      const firstError = [profileRes, boardRes, taskRes, friendRes, dailyRes, sessionRes].find((r) => r.error);
      if (firstError) { log("pull failed:", firstError.error.message); return false; }
      if (!profileRes.data) return false; // no server record yet

      const profile = profileFromRows({
        un: key,
        profileRow: profileRes.data,
        taskRows: taskRes.data || [],
        friendRows: friendRes.data || [],
      });
      // This write REPLACES the local record, and a project without migration
      // 005 returns no difficulty/description — so without this, every pull
      // would erase the two fields the user typed on this device. See
      // keepLocalTaskMeta: server values still win wherever they exist.
      const prevLocal = await store.get(`u:${key}`).catch(() => null);
      profile.tasks = keepLocalTaskMeta(profile.tasks, prevLocal?.tasks);
      // A running focus window is device state: this device owns its timer, and
      // a pull landing mid-session must not silently cancel a countdown that is
      // still ticking (the window is published again on the next push, which is
      // how the browser extension learns Focus Mode is on).
      const localFocus = prevLocal?.blocking?.focus;
      if (localFocus && Number(localFocus.endAt) > Date.now()) {
        profile.blocking = { ...profile.blocking, focus: localFocus };
      }
      await store.set(`u:${key}`, profile);
      await store.set(`bd:${key}`, (boardRes.data || []).map(rowToBoard));

      // Today's raw sessions (what the Focus screen lists) and the derived daily
      // totals (what the heatmap reads). daily_focus is written only by the
      // database, so the pulled numbers cannot have been chosen by a client.
      const today = ymd(new Date());
      await store.set(`fs:${key}:${today}`, (sessionRes.data || []).map(rowToSession));
      for (const row of dailyRes.data || []) {
        await store.set(`fo:${key}:${row.day}`, { s: row.focus_s });
      }
      return true;
    } catch (err) {
      log("pull threw:", err?.message || err);
      return false;
    } finally {
      applying = false;
    }
  }

  /**
   * Link this device to the account: push what is here first (so a record made
   * before signing in is not discarded), then adopt the server's copy.
   */
  async function bootstrap(username) {
    if (!ready()) return false;
    const key = username || un;
    const local = await store.get(`u:${key}`);
    // Pull FIRST, then push. The old order (push → pull) let a device with a
    // half-populated local record push BEFORE it had seen the server: a fresh
    // device's `tasks: []` prune would then DELETE the server rows another
    // device had created, and only afterwards pull down the emptiness — silent
    // cross-device data loss. Pulling first makes the server's state the base;
    // the subsequent push offers only what this device adds on top of it.
    const pulled = await pull(key);
    if (local) {
      await enqueue(`u:${key}`);
      await enqueue(`bd:${key}`);
      const today = ymd(new Date());
      if (await store.get(`fs:${key}:${today}`)) await enqueue(`fs:${key}:${today}`);
      await flush("bootstrap");
    }
    return pulled;
  }

  /**
   * Read the account's theme straight from the cloud, before bootstrap runs.
   * App calls this at sign-in to resolve local-vs-cloud without waiting for
   * (or racing) the full pull. Returns null when there is no row yet (fresh
   * account), no field yet, or the network fails — all three mean "the device
   * keeps its current choice", which is also the offline answer.
   */
  async function peekTheme() {
    if (!ready()) return null;
    try {
      const { data, error } = await client
        .from("profiles")
        .select("settings->theme")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        log("theme peek failed:", error.message);
        return null;
      }
      // `settings->theme` arrives as { theme: "<environment id>" } (null when absent).
      return data?.theme ?? null;
    } catch (e) {
      log("theme peek threw:", e?.message || e);
      return null;
    }
  }

  /**
   * Does this auth user already have a North account (a profiles row)?
   *
   * The profiles row is created by the `on_auth_user_created` trigger at
   * signup, so its existence is exactly the "has completed sign-up" fact —
   * and asking about ONE'S OWN row after being authenticated is the query
   * RLS was built to allow: no other user's data is touched, nothing is
   * enumerable, no privileged role is involved.
   *
   * Used by the auth flow to keep "Sign in" and "Sign up" honest: a Google
   * OAuth sign-in creates the auth user before the app ever runs, so intent
   * (which screen the person used) is enforced afterwards — an unknown
   * account arriving from the Sign in screen is signed back out with a clear
   * message instead of silently becoming a sign-up.
   */
  async function hasAccount() {
    if (!ready()) return false;
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        log("account probe failed:", error.message);
        return false; // fail closed: treat as unknown → sign-up intent
      }
      return Boolean(data);
    } catch (e) {
      log("account probe threw:", e?.message || e);
      return false;
    }
  }

  /**
   * The social graph, through the friend_action RPC (migration 003). All
   * actions are server-enforced: the RPC checks ownership and reciprocity,
   * so a client can only ever act on edges that genuinely involve it.
   * Returns the RPC's result string, or throws a display-ready message.
   */
  async function friendAction(requesterUn, action) {
    if (!ready()) throw new Error("not signed in");
    const { data, error } = await client.rpc("friend_action", {
      p_requester_un: requesterUn,
      p_action: action,
    });
    if (error) throw new Error(error.message);
    // Refresh my own edges + the friend feed after any mutation.
    await pull().catch(() => {});
    return data;
  }

  /** The friend feed: public productivity numbers for my accepted friends. */
  async function friendFeed() {
    if (!ready()) return [];
    const { data, error } = await client.rpc("friend_feed");
    if (error) { log("friend feed failed:", error.message); return []; }
    return (data || []).map((r) => ({
      un: r.un,
      name: r.name || r.un,
      fm: Number(r.focus_minutes) || 0,
      activeDays: Number(r.active_days) || 0,
      last: r.last_active || "",
    }));
  }

  /**
   * The public leaderboard. A SECURITY DEFINER function on the server (it
   * returns aggregates, never another user's rows), and the one read that must
   * be live rather than cached. Results are written into the shared `lb:` keys
   * the Social screen already reads.
   */
  async function leaderboard(limit = 25) {
    if (!ready()) return null;
    const { data, error } = await client.rpc("leaderboard", { limit_count: limit });
    if (error) { log("leaderboard failed:", error.message); return null; }
    const entries = (data || []).map((r) => ({
      un: r.un,
      name: r.name || r.un,
      fm: Number(r.focus_minutes) || 0,
      activeDays: Number(r.active_days) || 0,
      last: r.last_active || "",
      // Completed tasks and streaks are not part of the public aggregate, so
      // they are reported as absent rather than as a misleading zero.
      tc: null,
      streak: null,
    }));
    applying = true;
    try {
      for (const e of entries) {
        // Merge rather than overwrite: the aggregate carries focus minutes,
        // while the completed-task count and the streak are computed on this
        // device. Without the merge a leaderboard refresh would erase the
        // user's own streak from the Home screen.
        const previous = await store.get(`lb:${e.un}`, true);
        await store.set(
          `lb:${e.un}`,
          {
            ...previous,
            ...e,
            tc: Number.isFinite(previous?.tc) ? previous.tc : e.tc,
            streak: e.un === un && Number.isFinite(previous?.streak) ? previous.streak : e.streak,
            last: e.last || previous?.last || "",
          },
          true
        );
      }
    } finally { applying = false; }
    return entries;
  }

  return {
    /** Called whenever the signed-in account changes. */
    attach(session) {
      const nextUserId = session?.userId || null;
      const changed = nextUserId !== userId;
      userId = nextUserId;
      un = session?.un || null;
      if (changed) {
        // Anything already queued belongs to the previous account.
        writeQueue([]);
        pushed.clear();
      }
    },
    detach() { userId = null; un = null; pushed.clear(); },
    ready,
    flush,
    flushProfile,
    pull,
    bootstrap,
    peekTheme,
    hasAccount,
    friendAction,
    friendFeed,
    leaderboard,
    pendingCount: readQueue,
    /** Queue a local change for the server. Called by `S.set`. */
    afterWrite(key) {
      if (!ready() || applying || !pushable(key)) return;
      enqueue(key).then(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { flush("debounced").catch(() => {}); }, 900);
      });
    },
  };
}
