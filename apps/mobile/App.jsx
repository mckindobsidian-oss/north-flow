/**
 * Focusly mobile (Expo) — the same product as the web app, sharing the same
 * account/backend once Supabase lands. This shell mirrors the web tabs and
 * states honestly what each screen needs. Nothing is faked: screens without
 * real data show "coming with the shared backend", not mock numbers.
 */
import { useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

const TABS = [
  { id: "home", icon: "home-outline", label: "Home" },
  { id: "focus", icon: "timer-outline", label: "Focus" },
  { id: "tasks", icon: "checkbox-outline", label: "Tasks" },
  { id: "boards", icon: "grid-outline", label: "Boards" },
  { id: "calendar", icon: "calendar-outline", label: "Cal" },
  { id: "apps", icon: "shield-outline", label: "Apps" },
  { id: "social", icon: "people-outline", label: "Social" },
];

const NOTES = {
  home: "Dashboard with today's stats and your activity heatmap. Data syncs from the shared Focusly account once Supabase lands.",
  focus: "The full Pomodoro engine already lives in the web app and will be reused here. Device blocking (Screen Time / Usage Access) is the mobile-specific layer — it needs native permissions and comes in a later milestone.",
  tasks: "Task list + kanban boards share one task store. Wired to the same account data in the backend phase.",
  boards: "Kanban boards (To do / Doing / Done) — same cards as Tasks.",
  calendar: "Personal calendar; real Google Calendar sync needs the OAuth phase (see SETUP.md).",
  apps: "Set limits for apps — enforced on device via iOS Screen Time API / Android UsageStats, NOT from a web page. That integration is a later milestone.",
  social: "Leaderboard and friends — must be server-backed so stats can't be faked. Comes with the Supabase phase.",
};

export default function App() {
  const scheme = useColorScheme(); // auto light/dark — no toggle
  const dark = scheme === "dark";
  const [tab, setTab] = useState("home");

  const s = styles(dark);
  const cur = TABS.find((t) => t.id === tab);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={s.header}>
        <View style={s.logo}><Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>⚡</Text></View>
        <Text style={s.title}>Focusly</Text>
        <Text style={s.name}>Aarav</Text>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.h2}>{cur.label}</Text>
        <View style={s.card}>
          <Ionicons name="construct-outline" size={22} color="#007AFF" />
          <Text style={s.cardText}>{NOTES[tab]}</Text>
        </View>
        <Text style={s.muted}>
          This Expo scaffold shares the web app's tab structure and will reuse
          its components + the shared Supabase backend. Run it with `npx expo start`.
        </Text>
      </ScrollView>

      <View style={s.nav}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.id} style={s.tab} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Ionicons name={t.icon} size={19} color={tab === t.id ? "#007AFF" : dark ? "#636366" : "#AFAFB6"} />
            <Text style={[s.tabLbl, tab === t.id && { color: "#007AFF", fontWeight: "700" }]}>{t.label.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
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
    body: { padding: 16, paddingBottom: 90 },
    h2: { fontSize: 26, fontWeight: "700", color: dark ? "#F2F2F7" : "#1C1C1E", letterSpacing: -0.5, marginBottom: 14, marginTop: 4 },
    card: { backgroundColor: dark ? "#1C1C1E" : "#FFFFFF", borderRadius: 14, padding: 16, flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 12 },
    cardText: { flex: 1, fontSize: 13, color: dark ? "#F2F2F7" : "#1C1C1E", lineHeight: 19 },
    muted: { fontSize: 11, color: dark ? "#636366" : "#AFAFB6", lineHeight: 16 },
    nav: {
      flexDirection: "row", position: "absolute", left: 0, right: 0, bottom: 0,
      paddingBottom: 6, paddingTop: 4,
      backgroundColor: dark ? "rgba(20,20,22,.85)" : "rgba(249,249,251,.92)",
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? "#38383A" : "#E2E3E9",
    },
    tab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 },
    tabLbl: { fontSize: 8, letterSpacing: 0.4, color: dark ? "#636366" : "#AFAFB6" },
  });
