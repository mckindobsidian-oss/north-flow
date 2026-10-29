/**
 * NORTH mobile — the auth screen.
 *
 * North Glass language on the phone: translucent sheet over the ambient
 * gradient, one accent action, restrained type. Email + password sign in /
 * sign up with the same confirmation flow as web, plus real Google sign-in
 * (PKCE deep-link flow in lib/auth.js — no client secret on device; the same
 * NORTH account and data model as every other client). Unconfigured or
 * missing-native-module states surface honest errors, never fake success.
 */
import { useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
  ScrollView, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import Ionicons from './NorthIcon.jsx';
import { StatusBar } from "expo-status-bar";
import { GLASS, MobileBackdrop } from './MobileAppearance.jsx';

import { signInWithPassword, signUpWithPassword, resendConfirmation, signInWithGoogle, supabaseConfigured } from "./lib/auth.js";

const RESEND_WAIT = 30;

export default function AuthScreen({ dark, onAuthed }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [resendAt, setResendAt] = useState(0);

  const g = dark
    ? { bg: "#070816", sheet: GLASS, edge: "rgba(255,255,255,0.22)", txt: "#F7F5FF", sub: "#D2CEDF", input: "rgba(255,255,255,0.09)", acc: "#A996E8" }
    : { bg: "#EEF1F8", sheet: "rgba(255,255,255,0.80)", edge: "rgba(0,0,0,0.08)", txt: "#1C1C1E", sub: "#6D6D72", input: "rgba(255,255,255,0.6)", acc: "#007AFF" };

  const waiting = resendAt > Date.now();
  const cooldown = waiting ? Math.ceil((resendAt - Date.now()) / 1000) : 0;

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (pass.length < 8) return "Use at least 8 characters for your password.";
    if (mode === "register" && !name.trim()) return "Tell us your name.";
    return "";
  };

  const submit = async () => {
    if (busy) return;
    const v = validate();
    if (v) return setErr(v);
    if (!supabaseConfigured) return setErr("Accounts aren't configured on this device.");
    setBusy(true); setErr("");
    try {
      if (mode === "login") {
        onAuthed(await signInWithPassword(email, pass));
      } else {
        const res = await signUpWithPassword(email, pass, name);
        if (res.needsConfirmation) setSentTo(res.email);
        else onAuthed(res.user);
      }
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      onAuthed(await signInWithGoogle());
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || waiting || !sentTo) return;
    setBusy(true); setErr("");
    try {
      await resendConfirmation(sentTo);
      setResendAt(Date.now() + RESEND_WAIT * 1000);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (value, onChange, extra = {}) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={dark ? "#C5BFD2" : "#6D6D72"}
      style={{
        backgroundColor: g.input, borderRadius: 12, borderWidth: 1, borderColor: g.edge,
        color: g.txt, fontSize: 16, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12,
      }}
      {...extra}
    />
  );

  return (
    <MobileBackdrop>
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingVertical: 56 }}>
          <View style={{
            backgroundColor: g.sheet, borderRadius: 22, borderWidth: 1, borderColor: g.edge,
            padding: 24, width: '100%', maxWidth: 460, alignSelf: 'center', shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
                <Image source={require('../../react-app/public/north-logo.png')} style={{width:38,height:38,borderRadius:12}} />
              </View>
              <View>
                <Text style={{ fontSize: 17, fontWeight: "800", color: g.txt, letterSpacing: -0.3 }}>NORTH</Text>
                <Text style={{ fontSize: 11, color: g.sub }}>Focus · Plan · Win your day</Text>
              </View>
            </View>

            {/* Sign in | Sign up */}
            <View style={{ flexDirection: "row", backgroundColor: g.input, borderRadius: 10, padding: 3, marginBottom: 18 }}>
              {[["login", "Log in"], ["register", "Sign up"]].map(([id, lbl]) => (
                <TouchableOpacity key={id} style={{
                  flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 8, borderRadius: 8, alignItems: "center",
                  backgroundColor: mode === id ? g.sheet : "transparent",
                }} onPress={() => { setMode(id); setErr(""); setSentTo(""); }}
                  accessibilityRole="tab" accessibilityState={{ selected: mode === id }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: mode === id ? g.txt : g.sub }}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {sentTo ? (
              <>
                <Text style={{ fontSize: 16, fontWeight: "700", color: g.txt }}>Confirm your email</Text>
                <Text style={{ fontSize: 12.5, color: g.sub, marginTop: 6, lineHeight: 20 }}>
                  A confirmation link is on its way to <Text style={{ color: g.txt, fontWeight: "600" }}>{sentTo}</Text>. Open it, then log in.
                </Text>
                <TouchableOpacity onPress={resend} disabled={busy || waiting}
                  accessibilityRole="button" accessibilityState={{ disabled: busy || waiting }}
                  style={{ marginTop: 14, backgroundColor: waiting ? g.input : g.acc, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: waiting ? g.sub : "#fff", fontWeight: "600", fontSize: 13 }}>
                    {waiting ? `Resend available in ${cooldown}s` : "Resend confirmation email"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 21, fontWeight: "700", color: g.txt, marginBottom: 4, letterSpacing: -0.4 }}>
                  {mode === "login" ? "Welcome back" : "Create your account"}
                </Text>
                <Text style={{ fontSize: 12, color: g.sub, marginBottom: 16 }}>
                  {mode === "login" ? "Log in with your email and password." : "Use your email and a password — that's all NORTH needs."}
                </Text>
                <View style={{ gap: 9 }}>
                  {mode === "register" && field(name, setName, { placeholder: "Full name", autoComplete: "name" })}
                  {field(email, setEmail, { placeholder: "Email", keyboardType: "email-address", autoComplete: "email" })}
                  {field(pass, setPass, { placeholder: mode === "login" ? "Password" : "Password (8+ characters)", secureTextEntry: true, autoComplete: mode === "login" ? "password" : "new-password" })}
                </View>
                {!!err && <Text accessibilityRole="alert" style={{ color: "#FF3B30", fontSize: 12, marginTop: 10 }}>{err}</Text>}
                <TouchableOpacity onPress={submit} disabled={busy}
                  accessibilityRole="button" accessibilityState={{ disabled: busy }}
                  style={{ marginTop: 14, backgroundColor: g.acc, borderRadius: 12, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: busy ? 0.7 : 1 }}>
                  {busy && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={{ color: "#0B0B0E", fontWeight: "700", fontSize: 15 }}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</Text>
                </TouchableOpacity>

                {/* Google — real PKCE flow via the north:// deep link. Same
                    account and data model as web; intent semantics match web.
                    Failures (missing native modules, unconfigured provider)
                    surface as honest errors from lib/auth.js. */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: g.edge }} />
                  <Text style={{ fontSize: 10, color: g.sub, letterSpacing: 0.6 }}>OR</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: g.edge }} />
                </View>
                <TouchableOpacity onPress={google} disabled={busy}
                  accessibilityRole="button" accessibilityLabel="Continue with Google"
                  style={{ marginTop: 12, backgroundColor: g.sheet, borderRadius: 12, borderWidth: 1, borderColor: g.edge, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: busy ? 0.6 : 1 }}>
                  <Ionicons name="logo-google" size={16} color="#EA4335" />
                  <Text style={{ color: g.txt, fontWeight: "600", fontSize: 13.5 }}>Continue with Google</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          <Text style={{ textAlign: "center", fontSize: 12, color: g.sub, marginTop: 18, lineHeight: 19, maxWidth: 460, alignSelf: 'center' }}>
            Your tasks, limits and focus history sync to your NORTH account — sign in on any device and they're there.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileBackdrop>
  );
}
