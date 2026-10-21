/**
 * NORTH mobile (Expo) — blocking foundation.
 *
 * WHAT IS REAL HERE
 *  - The same blocking model as every other client: rules, schedules, focus
 *    sessions and temporary unblocks, evaluated by the shared engine
 *    (./shared/blocking.js, generated from packages/shared-types) so the phone
 *    shows exactly the verdict the extension and desktop app act on.
 *  - Real configuration UI: add/remove website and application rules, set when
 *    each applies, create schedule windows, run a focus session.
 *  - Live status: the on-screen answer updates as schedules open/close.
 *
 * WHAT IS NOT HERE, AND WHY (stated on screen, never faked)
 *  - Enforcing app limits. iOS needs the Screen Time / FamilyControls
 *    entitlement, Android needs UsageStatsManager + a user-granted
 *    "usage access" permission. Both are native modules that require a custom
 *    development build — they cannot be delivered through this Expo shell, and
 *    no code here claims otherwise.
 *  - Persistence and notifications. `@react-native-async-storage/async-storage`
 *    and `expo-notifications` are not dependencies of this app (see README), so
 *    importing them would break `npx expo start` for anyone who has not
 *    installed them. State therefore lives for the session only, and the UI
 *    says so instead of implying it was saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View, useColorScheme,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import {
  defaultBlocking, normalizeState, normalizeHost, normalizeApp,
  newRule, newSchedule, upsertRule, removeRule, setRuleEnabled,
  upsertSchedule, removeSchedule, unblockUntil, startFocus,
  evaluateBlocking, describeBlocking, rulesByKind, RULE_WHEN_LABEL,
  WEEKDAY_LABELS, WORKDAYS,
} from "./shared/blocking.js";
import {
  restoreSession, signOut as authSignOut, onAuthChange, S, SYNC, sessionsPersist, newUuid,
} from "./lib/auth.js";
import { PROFILE_KEY } from "./shared/account.js";
import AuthScreen from "./AuthScreen.jsx";

const TABS = [
  { id: "home", icon: "home-outline", label: "Home" },
  { id: "focus", icon: "timer-outline", label: "Focus" },
  { id: "tasks", icon: "checkbox-outline", label: "Tasks" },
  { id: "calendar", icon: "calendar-outline", label: "Calendar" },
  { id: "block", icon: "shield-outline", label: "Guard" },
  { id: "social", icon: "people-outline", label: "Social" },
];

/** Screens that still need the shared backend / a native module, stated plainly. */
const NOTES = {
  home: "Dashboard with today's stats and your activity heatmap. It fills in once the shared NORTH account is reachable from the phone (Supabase phase, SETUP.md).",
  tasks: "Tasks use the same account record as the web app and sync when this device is signed in.",
  calendar: "Personal calendar. Real Google Calendar sync needs the OAuth phase (SETUP.md).",
  social: "Leaderboard and friends — server-backed so stats cannot be faked. Arrives with the Supabase phase.",
};

export default function App() {
  const scheme = useColorScheme(); // Apple-style: follows the device, no toggle
  const dark = scheme === "dark";
  const [tab, setTab] = useState("home");
  // Auth: restored from the persisted Supabase session (or the device record
  // when no account service is configured) before the UI is shown.
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  // The blocking model comes from the account profile (`u:<un>.blocking`) —
  // the SAME document the web app edits — so the phone shows the account's
  // rules, not a second copy. Edits here write back through S.* and sync.
  const [blocking, setBlockingState] = useState(() => normalizeState(defaultBlocking()));
  const userRef = useRef(null); userRef.current = user;
  const setBlocking = (next) => {
    const model = typeof next === "function" ? next(blocking) : next;
    setBlockingState(normalizeState(model));
    const un = userRef.current?.un;
    if (un) {
      S.get(PROFILE_KEY(un)).then((raw) => {
        if (raw) S.set(PROFILE_KEY(un), { ...raw, blocking: normalizeState(model) });
      });
    }
  };
  // The profile record re-reads after every sync pull so Home/Tasks show the
  // account's real tasks and stats, not a boot-time snapshot.
  const [profile, setProfile] = useState(null);
  const reloadProfile = () => {
    const un = userRef.current?.un;
    if (!un) return setProfile(null);
    S.get(PROFILE_KEY(un)).then((raw) => setProfile(raw || null));
  };
  useEffect(() => { reloadProfile(); }, [user?.un]);

  useEffect(() => {
    let dead = false;
    restoreSession()
      .then((u) => { if (!dead) setUser(u); })
      .catch(() => {})
      .finally(() => { if (!dead) setBooting(false); });
    const unsub = onAuthChange((u) => { if (!dead) setUser(u); });
    return () => { dead = true; unsub(); };
  }, []);

  // Adopt the account's blocking document whenever the profile changes.
  useEffect(() => {
    if (profile?.blocking) setBlockingState(normalizeState(profile.blocking));
  }, [profile?.blocking]);

  // A quiet refresh loop: signed-in devices re-pull periodically so edits
  // made elsewhere appear without a restart (the web app pushes on write;
  // this client keeps it simple and pulls).
  useEffect(() => {
    if (!user?.authLinked) return;
    const id = setInterval(() => {
      SYNC.pull().then(reloadProfile).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [user?.authLinked, user?.un]);

  const s = styles(dark);
  const cur = TABS.find((t) => t.id === tab);

  if (booting) {
    return (
      <SafeAreaView style={[s.root, { alignItems: "center", justifyContent: "center" }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <Ionicons name="compass" size={36} color="#007AFF" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return <AuthScreen dark={dark} onAuthed={(u) => setUser(u)} />;
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={s.header}>
        <View style={s.logo}><Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>⚡</Text></View>
        <Text style={s.title}>NORTH</Text>
        <TouchableOpacity onPress={() => authSignOut().then(() => setUser(null))}
          accessibilityRole="button" accessibilityLabel={`Signed in as ${user.name || user.un}. Sign out`}>
          <Text style={s.name}>{user.name || user.un} · Sign out</Text>
        </TouchableOpacity>
      </View>

      {tab === "block" ? (
        <Blocking dark={dark} s={s} blocking={blocking} setBlocking={setBlocking} />
      ) : (
        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.h2}>{cur.label}</Text>
          {tab === "home" ? (
            <Home dark={dark} s={s} profile={profile} go={setTab} />
          ) : tab === "tasks" ? (
            <Tasks dark={dark} s={s} user={user} profile={profile} onChanged={reloadProfile} />
          ) : tab === "focus" ? (
            <>
              <View style={s.card}>
                <Ionicons name="timer-outline" size={22} color="#007AFF" />
                <Text style={s.cardText}>
                  The full Pomodoro engine lives in the web app and will be reused here.
                  Until it is ported, "Block" is the phone's working screen: it configures
                  the same rules the other clients enforce.
                </Text>
              </View>
              <TouchableOpacity style={s.primary} onPress={() => setTab("block")} accessibilityRole="button">
                <Text style={s.primaryText}>Open blocking</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={s.card}>
              <Ionicons name="construct-outline" size={22} color="#007AFF" />
              <Text style={s.cardText}>{NOTES[tab]}</Text>
            </View>
          )}
          <Text style={s.muted}>
            {user.authLinked
              ? `Signed in as ${user.email || user.un}${sessionsPersist ? " — your session and data persist on this device." : " — install @react-native-async-storage/async-storage so your session and data survive restarts."}`
              : "No account service configured — this device keeps data locally for now."}
            {" "}This shell mirrors the web app's tabs and shares its data model.
          </Text>
        </ScrollView>
      )}

      <View style={s.nav}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.id} style={s.tab} onPress={() => setTab(t.id)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Ionicons name={t.icon} size={19} color={tab === t.id ? "#007AFF" : dark ? "#636366" : "#AFAFB6"} />
            <Text style={[s.tabLbl, tab === t.id && { color: "#007AFF", fontWeight: "700" }]}>
              {t.label.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOME — real numbers from the account's profile document
// ══════════════════════════════════════════════════════════════════════════
function Home({ dark, s, profile, go }) {
  const tasks = profile?.tasks || [];
  const done = tasks.filter((t) => t.completed).length;
  const open = tasks.length - done;
  return (
    <>
      <View style={s.card}>
        <Text style={s.cardTitle}>Today</Text>
        <Text style={s.muted}>
          {tasks.length
            ? `${done} of ${tasks.length} tasks done · ${open} open`
            : "No tasks yet — add them on the Tasks tab (they sync with web)."}
        </Text>
      </View>
      <TouchableOpacity style={s.primary} onPress={() => go("tasks")} accessibilityRole="button">
        <Text style={s.primaryText}>Open tasks</Text>
      </TouchableOpacity>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TASKS — the account's real task list, edited through the same S.* boundary
// ══════════════════════════════════════════════════════════════════════════
function Tasks({ dark, s, user, profile, onChanged }) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const tasks = profile?.tasks || [];

  const persist = async (upd) => {
    const raw = await S.get(PROFILE_KEY(user.un));
    if (!raw) return;
    await S.set(PROFILE_KEY(user.un), { ...raw, tasks: upd });
    onChanged();
  };

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    if (!user?.un) return setErr("Sign in first.");
    await persist([...tasks, { id: newUuid(), title, completed: false, at: Date.now(), pri: "medium", cat: "Personal" }]);
    setDraft("");
    setErr("");
  };

  const toggle = (t) => persist(tasks.map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
  const remove = (t) => persist(tasks.filter((x) => x.id !== t.id));

  return (
    <>
      <View style={s.card}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="Add a task…"
            placeholderTextColor={dark ? "#636366" : "#AFAFB6"}
            value={draft} onChangeText={setDraft} onSubmitEditing={add} returnKeyType="done" />
          <TouchableOpacity style={s.primary} onPress={add} accessibilityRole="button" accessibilityLabel="Add task">
            <Text style={s.primaryText}>Add</Text>
          </TouchableOpacity>
        </View>
        {err ? <Text style={[s.muted, { color: "#FF3B30", marginTop: 6 }]}>{err}</Text> : null}
        {tasks.length === 0 ? (
          <Text style={s.muted}>Nothing yet. Tasks here are the same list the web app shows.</Text>
        ) : (
          tasks.map((t) => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? "#38383A" : "#E2E3E9" }}>
              <TouchableOpacity onPress={() => toggle(t)} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(t.completed) }}
                accessibilityLabel={`${t.completed ? "Mark incomplete" : "Complete"} ${t.title}`}>
                <Ionicons name={t.completed ? "checkmark-circle" : "ellipse-outline"} size={20} color={t.completed ? "#34C759" : "#007AFF"} />
              </TouchableOpacity>
              <Text style={{ flex: 1, fontSize: 14, color: dark ? "#F2F2F7" : "#1C1C1E", textDecorationLine: t.completed ? "line-through" : "none" }} numberOfLines={2}>
                {t.title}
              </Text>
              <TouchableOpacity onPress={() => remove(t)} accessibilityRole="button" accessibilityLabel={`Delete ${t.title}`}>
                <Ionicons name="close-circle-outline" size={18} color={dark ? "#636366" : "#AFAFB6"} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
      <Text style={s.muted}>
        Editing here writes the same profile record the web app reads; the next sync pushes it to your account.
      </Text>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BLOCKING — the phone's working screen
// ══════════════════════════════════════════════════════════════════════════
function Blocking({ dark, s, blocking, setBlocking }) {
  const [now, setNow] = useState(Date.now());
  const [site, setSite] = useState("");
  const [app, setApp] = useState("");
  const [err, setErr] = useState("");
  const [schedName, setSchedName] = useState("Work hours");
  const [schedDays, setSchedDays] = useState([...WORKDAYS]);
  const [schedStart, setSchedStart] = useState("09:00");
  const [schedEnd, setSchedEnd] = useState("17:00");

  // The verdict depends on the wall clock, so keep it fresh while the screen is
  // open — a schedule can open or a focus session can end underneath us.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const verdict = useMemo(() => evaluateBlocking(blocking, now), [blocking, now]);
  const status = useMemo(() => describeBlocking(blocking, now), [blocking, now]);
  const grouped = useMemo(() => rulesByKind(blocking), [blocking]);

  const addSite = () => {
    const host = normalizeHost(site);
    if (!host) return setErr("That doesn't look like a domain — try youtube.com");
    if (blocking.rules.some((r) => r.kind === "website" && r.target === host)) {
      return setErr(`${host} is already on the list.`);
    }
    setBlocking(upsertRule(blocking, newRule({ kind: "website", target: host })));
    setSite("");
    setErr("");
  };

  const addApp = () => {
    const name = normalizeApp(app);
    if (!name) return setErr("Name the application — e.g. Instagram");
    if (blocking.rules.some((r) => r.kind === "app" && r.target.toLowerCase() === name.toLowerCase())) {
      return setErr(`${name} is already on the list.`);
    }
    setBlocking(upsertRule(blocking, newRule({ kind: "app", target: name })));
    setApp("");
    setErr("");
  };

  const addSchedule = () => {
    if (!schedDays.length) return setErr("Pick at least one day for the schedule.");
    if (schedStart === schedEnd) return setErr("Start and end must differ.");
    setBlocking(upsertSchedule(blocking, newSchedule({ name: schedName || "Schedule", days: schedDays, start: schedStart, end: schedEnd })));
    setSchedName("Work hours");
    setErr("");
  };

  const toggleFocus = () => {
    const on = verdict.focus.active;
    setBlocking({ ...blocking, focus: on ? null : startFocus(25, Date.now()) });
  };

  const RuleRow = ({ rule }) => {
    const why = verdict.reasons[rule.id];
    const paused = why?.reason === "temp-unblock";
    const active = Boolean(why) && !paused;
    return (
      <View style={s.rule}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 15 }}>{rule.kind === "app" ? "🪟" : "🌐"}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.ruleTitle} numberOfLines={1}>
              {rule.target}
              {active ? "  ·  ACTIVE" : paused ? "  ·  PAUSED" : ""}
            </Text>
            <Text style={s.muted}>{RULE_WHEN_LABEL[rule.when]}</Text>
          </View>
          <TouchableOpacity onPress={() => setBlocking(setRuleEnabled(blocking, rule.id, !rule.enabled))}
            accessibilityRole="switch" accessibilityState={{ checked: rule.enabled }}
            accessibilityLabel={`${rule.enabled ? "Turn off" : "Turn on"} ${rule.target}`}
            style={[s.pill, rule.enabled ? s.pillOn : s.pillOff]}>
            <Text style={s.pillText}>{rule.enabled ? "On" : "Off"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setBlocking(removeRule(blocking, rule.id))}
            accessibilityRole="button" accessibilityLabel={`Remove the rule for ${rule.target}`}>
            <Ionicons name="close-circle-outline" size={20} color={dark ? "#636366" : "#AFAFB6"} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {["always", "focus", "scheduled"].map((w) => (
            <TouchableOpacity key={w}
              onPress={() => setBlocking(upsertRule(blocking, { ...rule, when: w }))}
              accessibilityRole="button" accessibilityState={{ selected: rule.when === w }}
              style={[s.chip, rule.when === w && s.chipOn]}>
              <Text style={[s.chipText, rule.when === w && s.chipTextOn]}>{RULE_WHEN_LABEL[w]}</Text>
            </TouchableOpacity>
          ))}
          {active && blocking.settings.allowTemporaryUnblock && (
            <TouchableOpacity
              onPress={() => setBlocking(unblockUntil(blocking, rule.id, blocking.settings.tempUnblockMinutes))}
              accessibilityRole="button"
              accessibilityLabel={`Pause ${rule.target} for ${blocking.settings.tempUnblockMinutes} minutes`}
              style={[s.chip, s.chipWarn]}>
              <Text style={[s.chipText, s.chipTextOn]}>Pause {blocking.settings.tempUnblockMinutes}m</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const Section = ({ title, note, children }) => (
    <View style={s.card}>
      <Text style={s.sec}>{title}</Text>
      {note ? <Text style={s.muted}>{note}</Text> : null}
      {children}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.h2}>Blocking</Text>

      {/* Verdict */}
      <View style={[s.card, verdict.active && s.cardActive]}>
        <Text style={{ fontSize: 22 }}>{verdict.active ? "🛡" : "🕊"}</Text>
        <Text style={s.cardTitle}>{status.headline}</Text>
        <Text style={s.muted}>{status.detail}</Text>
        {verdict.focus.active && (
          <Text style={[s.muted, { color: "#007AFF" }]}>Focus session · {verdict.focus.minutesLeft}m left</Text>
        )}
      </View>

      {/* Where it is enforced — the honest half of the story */}
      <View style={s.card}>
        <Text style={s.sec}>WHERE THIS IS ENFORCED</Text>
        <Text style={s.muted}>
          Websites are blocked by the NORTH browser extension. Applications are ended
          by the NORTH desktop app. iOS and Android only allow limits on other apps
          through an OS-granted entitlement (iOS Screen Time / Android UsageStats),
          which NORTH does not ship — so this screen configures rules for the clients
          that can enforce them, and nothing here pretends otherwise.
        </Text>
      </View>

      {/* Focus */}
      <Section title="FOCUS SESSION"
        note={verdict.focus.active ? "Rules marked “During focus” apply now." : "Rules marked “During focus” apply while a session runs."}>
        <TouchableOpacity style={[s.primary, verdict.focus.active && s.stop]} onPress={toggleFocus}
          accessibilityRole="button">
          <Text style={s.primaryText}>{verdict.focus.active ? "End focus session" : "Start 25-minute session"}</Text>
        </TouchableOpacity>
      </Section>

      {/* Websites */}
      <Section title="WEBSITES" note="Enforced by the browser extension.">
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="youtube.com"
            placeholderTextColor={dark ? "#636366" : "#AFAFB6"}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            value={site} onChangeText={setSite} onSubmitEditing={addSite} returnKeyType="done" />
          <TouchableOpacity style={s.primary} onPress={addSite} accessibilityRole="button"
            accessibilityLabel="Add a website">
            <Text style={s.primaryText}>Add</Text>
          </TouchableOpacity>
        </View>
        {grouped.websites.length === 0
          ? <Text style={s.muted}>No domains yet</Text>
          : grouped.websites.map((r) => <RuleRow key={r.id} rule={r} />)}
      </Section>

      {/* Applications */}
      <Section title="APPLICATIONS" note="Ended by the desktop client. Not enforceable from the phone yet.">
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="Steam"
            placeholderTextColor={dark ? "#636366" : "#AFAFB6"}
            autoCorrect={false}
            value={app} onChangeText={setApp} onSubmitEditing={addApp} returnKeyType="done" />
          <TouchableOpacity style={s.primary} onPress={addApp} accessibilityRole="button"
            accessibilityLabel="Add an application">
            <Text style={s.primaryText}>Add</Text>
          </TouchableOpacity>
        </View>
        {grouped.apps.length === 0
          ? <Text style={s.muted}>No applications yet</Text>
          : grouped.apps.map((r) => <RuleRow key={r.id} rule={r} />)}
      </Section>

      {/* Limits use the same account-owned blocking document as web and desktop. */}
      <Section title="SHARED LIMITS" note="These limits sync with your North account. Website limits are enforced by the browser extension; desktop app limits by the desktop client. Android currently displays shared limits but does not enforce screen-time caps.">
        {blocking.usageLimits.length === 0
          ? <Text style={s.muted}>No shared limits are set.</Text>
          : blocking.usageLimits.map((limit) => (
            <View key={limit.id} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: dark ? "#38383A" : "#E5E5EA" }}>
              <Text style={s.ruleTitle}>{limit.name ? `${limit.name} · ` : ""}{limit.target}</Text>
              <Text style={s.muted}>{limit.mode === "session" ? "Per-visit allowance" : `Daily allowance · ${limit.dailyLimitMinutes} min`}{limit.enabled === false ? " · Off" : ""}</Text>
            </View>
          ))}
      </Section>

      {/* Schedules */}
      <Section title="SCHEDULES" note="Windows that scheduled rules follow — including overnight ones.">
        {blocking.schedules.map((sc) => {
          const running = verdict.schedules.some((r) => r.id === sc.id);
          return (
            <View key={sc.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.ruleTitle} numberOfLines={1}>
                  {sc.name}{running ? "  ·  RUNNING" : ""}{sc.enabled ? "" : "  ·  OFF"}
                </Text>
                <Text style={s.muted}>
                  {sc.days.map((d) => WEEKDAY_LABELS[d]).join(" ")} · {sc.start}–{sc.end}
                  {sc.start > sc.end ? " (overnight)" : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setBlocking(upsertSchedule(blocking, { ...sc, enabled: !sc.enabled }))}
                accessibilityRole="switch" accessibilityState={{ checked: sc.enabled }}
                accessibilityLabel={`${sc.enabled ? "Disable" : "Enable"} ${sc.name}`}
                style={[s.pill, sc.enabled ? s.pillOn : s.pillOff]}>
                <Text style={s.pillText}>{sc.enabled ? "On" : "Off"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setBlocking(removeSchedule(blocking, sc.id))}
                accessibilityRole="button" accessibilityLabel={`Delete the schedule ${sc.name}`}>
                <Ionicons name="close-circle-outline" size={20} color={dark ? "#636366" : "#AFAFB6"} />
              </TouchableOpacity>
            </View>
          );
        })}

        <TextInput style={[s.input, { marginTop: 10 }]} placeholder="Schedule name"
          placeholderTextColor={dark ? "#636366" : "#AFAFB6"}
          value={schedName} onChangeText={setSchedName} />
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {WEEKDAY_LABELS.map((lbl, i) => {
            const on = schedDays.includes(i);
            return (
              <TouchableOpacity key={lbl}
                onPress={() => setSchedDays(on ? schedDays.filter((d) => d !== i) : [...schedDays, i].sort((a, b) => a - b))}
                accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`${lbl}${on ? " on" : " off"}`}
                style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} value={schedStart} onChangeText={setSchedStart}
            accessibilityLabel="Schedule start time" />
          <TextInput style={[s.input, { flex: 1 }]} value={schedEnd} onChangeText={setSchedEnd}
            accessibilityLabel="Schedule end time" />
        </View>
        <TouchableOpacity style={[s.primary, { marginTop: 8 }]} onPress={addSchedule}
          accessibilityRole="button" accessibilityLabel="Add schedule">
          <Text style={s.primaryText}>Add schedule</Text>
        </TouchableOpacity>
      </Section>

      {err ? <Text style={[s.muted, { color: "#FF3B30" }]}>{err}</Text> : null}

      <Text style={[s.muted, { marginTop: 4 }]}>
        Rules live in memory while this app is open. Installing
        {" "}<Text style={s.code}>@react-native-async-storage/async-storage</Text> and
        {" "}<Text style={s.code}>expo-notifications</Text> (see apps/mobile/README.md)
        adds persistence and reminders — neither is a dependency yet, so nothing
        claims your changes were saved.
      </Text>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = (dark) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: dark ? "#000" : "#F2F2F7" },
    header: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: dark ? "rgba(20,20,22,.8)" : "rgba(249,249,251,.85)",
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: dark ? "#38383A" : "#E2E3E9",
    },
    logo: { width: 24, height: 24, borderRadius: 7, backgroundColor: "#007AFF", alignItems: "center", justifyContent: "center" },
    title: { fontSize: 15, fontWeight: "700", color: dark ? "#F2F2F7" : "#1C1C1E", flex: 1 },
    name: { fontSize: 12, color: dark ? "#98989E" : "#6D6D72", fontWeight: "600" },
    body: { padding: 16, paddingBottom: 96 },
    h2: { fontSize: 26, fontWeight: "700", color: dark ? "#F2F2F7" : "#1C1C1E", letterSpacing: -0.5, marginBottom: 14, marginTop: 4 },
    card: {
      backgroundColor: dark ? "#1C1C1E" : "#FFFFFF", borderRadius: 14, padding: 14,
      marginBottom: 12, gap: 6,
      borderWidth: 1, borderColor: dark ? "#38383A" : "#E2E3E9",
    },
    cardActive: { borderColor: "#FF3B3060", backgroundColor: dark ? "#2A1A1A" : "#FFF2F1" },
    cardTitle: { fontSize: 15, fontWeight: "700", color: dark ? "#F2F2F7" : "#1C1C1E" },
    cardText: { flex: 1, fontSize: 13, color: dark ? "#F2F2F7" : "#1C1C1E", lineHeight: 19 },
    sec: { fontSize: 10, letterSpacing: 0.7, fontWeight: "700", color: dark ? "#98989E" : "#6D6D72", marginBottom: 2 },
    muted: { fontSize: 11.5, color: dark ? "#98989E" : "#6D6D72", lineHeight: 17 },
    code: { fontSize: 11, color: "#007AFF" },
    input: {
      borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13,
      borderColor: dark ? "#38383A" : "#E2E3E9", backgroundColor: dark ? "#000" : "#F7F7FA",
      color: dark ? "#F2F2F7" : "#1C1C1E",
    },
    primary: {
      backgroundColor: "#007AFF", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
      alignItems: "center", justifyContent: "center",
    },
    stop: { backgroundColor: "#FF3B30" },
    primaryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
    rule: {
      paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: dark ? "#38383A" : "#E2E3E9",
    },
    ruleTitle: { fontSize: 13.5, fontWeight: "600", color: dark ? "#F2F2F7" : "#1C1C1E" },
    chip: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
      borderWidth: 1, borderColor: dark ? "#38383A" : "#E2E3E9",
      backgroundColor: dark ? "#1C1C1E" : "#F7F7FA",
    },
    chipOn: { backgroundColor: "#007AFF", borderColor: "#007AFF" },
    chipWarn: { backgroundColor: "#FF9500", borderColor: "#FF9500" },
    chipText: { fontSize: 11, fontWeight: "600", color: dark ? "#98989E" : "#6D6D72" },
    chipTextOn: { color: "#fff" },
    pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
    pillOn: { backgroundColor: "#34C759" },
    pillOff: { backgroundColor: dark ? "#3A3A3C" : "#D8D8DE" },
    pillText: { fontSize: 11, fontWeight: "700", color: "#fff" },
    nav: {
      flexDirection: "row", position: "absolute", left: 0, right: 0, bottom: 0,
      paddingBottom: 6, paddingTop: 4,
      backgroundColor: dark ? "rgba(20,20,22,.85)" : "rgba(249,249,251,.92)",
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? "#38383A" : "#E2E3E9",
    },
    tab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 },
    tabLbl: { fontSize: 8, letterSpacing: 0.4, color: dark ? "#636366" : "#AFAFB6" },
  });
