// NORTH desktop — Tauri 2 client.
//
// WHAT IS REAL HERE
//  - A window with the NORTH shell (static page in ../dist) plus a system tray.
//  - Block rules for applications, persisted as JSON in the app config dir.
//  - Process enumeration via `sysinfo`, and an enforcement loop that ENDS the
//    processes whose rules are active (always-on, during a focus session, or
//    inside a schedule window).
//  - Focus sessions with a wall-clock deadline, mirrored in the tray tooltip.
//  - Windows foreground-app usage sampling while signed into a North account;
//    executable names and durations only, stored by account and UTC day.
//  - Temporary unblocks with an expiry, exactly like the other clients.
//
// WHAT THIS CANNOT DO (documented, not faked)
//  - Prevent a program from *starting*. Enforcing "app X is blocked" from
//    user space means noticing and terminating it, which is what this does;
//    the process can still launch and be killed a moment later. True
//    prevention needs a driver / MDM profile (Windows Filtering or macOS
//    Endpoint Security), which is out of scope for a normal app.
//  - Block websites. A desktop app does not own the browser; that is the
//    extension's job (apps/extension). The UI says so.
//  - Kill processes owned by other users, or protected system processes: the
//    OS refuses, and we never try — a small denylist plus permission errors
//    are handled explicitly rather than retried in a loop.
//
// THE SHARED MODEL
// The rule/schedule/focus JSON here is byte-compatible with the JS engine in
// packages/shared-types/blocking.js (camelCase field names, same semantics),
// so one account has one blocking model on every client. The schedule window
// logic below is the one unavoidable re-implementation: a Rust process cannot
// call into the JS module, and the platform capability belongs here. It is
// kept deliberately small and mirrors `isScheduleActive` exactly, including
// cross-midnight windows and the "zero-length window never blocks" rule.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{Emitter, Manager, State};

// ── shared model ──────────────────────────────────────────────────────────
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    id: String,
    kind: String, // "app" | "website" (websites are configured here, enforced by the extension)
    target: String,
    label: String,
    enabled: bool,
    when: String, // "always" | "focus" | "scheduled"
    #[serde(default)]
    schedule_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Schedule {
    id: String,
    name: String,
    days: Vec<u8>, // 0 = Sunday … 6 = Saturday (JS convention, so the model matches)
    start: String, // "HH:MM"
    end: String,
    enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageLimit {
    id: String,
    #[serde(default = "default_limit_kind")]
    kind: String,
    target: String,
    #[serde(default = "default_limit_mode")]
    mode: String,
    #[serde(default)]
    daily_limit_minutes: u32,
    #[serde(default)]
    enabled: bool,
}

fn default_limit_kind() -> String { "website".into() }
fn default_limit_mode() -> String { "daily".into() }
type Usage = HashMap<String, HashMap<String, HashMap<String, u64>>>;
type HourlyUsage = HashMap<String, HashMap<String, HashMap<String, HashMap<String, u64>>>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    block_during_focus: bool,
    allow_temporary_unblock: bool,
    temp_unblock_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self { block_during_focus: true, allow_temporary_unblock: true, temp_unblock_minutes: 5 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Focus {
    started_at: u64,
    minutes: u32,
    end_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockingState {
    version: u32,
    #[serde(default)]
    rules: Vec<Rule>,
    #[serde(default)]
    schedules: Vec<Schedule>,
    #[serde(default)]
    usage_limits: Vec<UsageLimit>,
    #[serde(default)]
    settings: Settings,
    #[serde(default)]
    unblocks: HashMap<String, u64>,
    #[serde(default)]
    focus: Option<Focus>,
    /// Linked NORTH account name (identity only until the Supabase phase).
    #[serde(default)]
    account: Option<String>,
}

impl Default for BlockingState {
    fn default() -> Self {
        Self {
            version: 2,
            rules: Vec::new(),
            schedules: Vec::new(),
            usage_limits: Vec::new(),
            settings: Settings::default(),
            unblocks: HashMap::new(),
            focus: None,
            account: None,
        }
    }
}

/// One process we noticed and acted on — surfaced in the UI so the app can be
/// held accountable for what it actually did.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnforcementEvent {
    at: u64,
    name: String,
    pid: u32,
    rule: String,
    result: String, // "killed" | "refused"
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    pids: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    active: bool,
    reason: String,
    focus_active: bool,
    focus_seconds_left: u64,
    blocking_apps: Vec<String>,
    running_apps: Vec<AppInfo>,
    running_schedules: Vec<String>,
}

// ── runtime state ─────────────────────────────────────────────────────────
struct AppState {
    blocking: Mutex<BlockingState>,
    events: Mutex<Vec<EnforcementEvent>>,
    usage: Mutex<Usage>,
    hourly_usage: Mutex<HourlyUsage>,
    session_usage: Mutex<HashMap<String, HashMap<String, u64>>>,
    remote_usage: Mutex<Usage>,
    usage_owner: Mutex<Option<String>>,
    path: PathBuf,
    usage_path: PathBuf,
    hourly_usage_path: PathBuf,
}

type R<T> = Result<T, String>;
type Ctx<'a> = State<'a, Arc<AppState>>;

/// Processes we will never terminate, no matter what a rule says. Killing a
/// desktop shell or a session manager would take the machine down with it.
const PROTECTED: &[&str] = &[
    "system", "system idle process", "registry", "smss", "csrss", "wininit", "winlogon",
    "services", "lsass", "svchost", "explorer", "dwm", "taskhostw", "sihost", "ctfmon",
    "launchd", "kernel_task", "windowserver", "loginwindow", "finder", "dock", "systemd",
    "init", "gnome-shell", "kwin", "plasmashell", "xorg", "wayland", "north-desktop",
    "searchapp", "searchhost", "searchui", "startmenuexperiencehost", "shellexperiencehost",
    "lockapp", "textinputhost", "runtimebroker", "widgets", "widgetservice",
];

const BROWSERS: &[&str] = &["brave", "brave-browser", "chrome", "chromium", "edge", "msedge", "firefox", "google-chrome", "opera", "vivaldi"];

fn utc_day(ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(ms.min(i64::MAX as u64) as i64)
        .unwrap_or_else(chrono::Utc::now).format("%Y-%m-%d").to_string()
}

fn load_usage(path: &PathBuf) -> Usage {
    fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_usage(state: &AppState) {
    if let Some(data) = state.usage.lock().ok().and_then(|usage| serde_json::to_vec(&*usage).ok()) {
        let _ = fs::write(&state.usage_path, data);
    }
    if let Some(data) = state.hourly_usage.lock().ok().and_then(|usage| serde_json::to_vec(&*usage).ok()) {
        let _ = fs::write(&state.hourly_usage_path, data);
    }
    if let Some(data) = state.remote_usage.lock().ok().and_then(|usage| serde_json::to_vec(&*usage).ok()) {
        let _ = fs::write(state.usage_path.with_file_name("north-remote-usage.json"), data);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageRow { day: String, name: String, seconds: u64, hourly: HashMap<String, u64> }

fn foreground_app() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStringExt;
        use std::ffi::OsString;
        #[repr(C)] struct LastInputInfo { size: u32, tick: u32 }
        #[link(name = "user32")] extern "system" {
            fn GetForegroundWindow() -> isize;
            fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
            fn GetLastInputInfo(info: *mut LastInputInfo) -> i32;
        }
        #[link(name = "kernel32")] extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
            fn QueryFullProcessImageNameW(process: isize, flags: u32, name: *mut u16, size: *mut u32) -> i32;
            fn CloseHandle(handle: isize) -> i32;
            fn GetTickCount() -> u32;
        }
        unsafe {
            let mut input = LastInputInfo { size: std::mem::size_of::<LastInputInfo>() as u32, tick: 0 };
            if GetLastInputInfo(&mut input) == 0 || GetTickCount().wrapping_sub(input.tick) > 60_000 { return None; }
            let hwnd = GetForegroundWindow();
            if hwnd == 0 { return None; }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 { return None; }
            let handle = OpenProcess(0x1000, 0, pid);
            if handle == 0 { return None; }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(handle);
            if ok == 0 { return None; }
            let full = OsString::from_wide(&buf[..len as usize]).to_string_lossy().to_string();
            let name = std::path::Path::new(&full).file_stem()?.to_string_lossy().trim().to_string();
            if name.is_empty() || is_protected(&name) || BROWSERS.iter().any(|b| b.eq_ignore_ascii_case(&name)) { return None; }
            Some(name)
        }
    }
    #[cfg(not(target_os = "windows"))]
    { None }
}

fn sample_foreground_usage(state: &AppState) {
    if let (Some(owner), Some(name)) = (state.usage_owner.lock().unwrap().clone(), foreground_app()) {
        let day = utc_day(now_ms());
        let cutoff = utc_day(now_ms().saturating_sub(90 * 86_400_000));
        let mut usage = state.usage.lock().unwrap();
        let days = usage.entry(owner.clone()).or_default();
        days.retain(|date, _| date >= &cutoff);
        let seconds = days.entry(day.clone()).or_default().entry(name.clone()).or_default();
        *seconds += 1;
        drop(usage);
        let mut hourly = state.hourly_usage.lock().unwrap();
        let days = hourly.entry(owner.clone()).or_default();
        days.retain(|date, _| date >= &cutoff);
        *days.entry(day).or_default().entry(name.clone()).or_default()
            .entry(chrono::Utc::now().hour().to_string()).or_default() += 1;
        drop(hourly);
        *state.session_usage.lock().unwrap().entry(owner).or_default().entry(app_key(&name)).or_default() += 1;
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{:x}", now_ms())
}

fn normalize_app(input: &str) -> String {
    input.trim().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Executable names arrive with and without an extension depending on the OS.
fn app_key(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// Case-insensitive match between a rule target and a live process name.
fn app_matches(process_name: &str, target: &str) -> bool {
    let p = app_key(process_name);
    let t = app_key(target);
    !t.is_empty() && p == t
}

fn is_protected(name: &str) -> bool {
    let key = app_key(name);
    PROTECTED.iter().any(|p| app_key(p) == key)
}

// ── schedules (mirror of isScheduleActive in the shared JS engine) ────────
fn minutes_of(hhmm: &str) -> Option<u32> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    if h > 23 || m > 59 { None } else { Some(h * 60 + m) }
}

fn dow_index(w: Weekday) -> u8 {
    match w {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

fn is_schedule_active(s: &Schedule, now: chrono::DateTime<Local>) -> bool {
    if !s.enabled || s.days.is_empty() {
        return false;
    }
    let (Some(start), Some(end)) = (minutes_of(&s.start), minutes_of(&s.end)) else {
        return false;
    };
    if start == end {
        return false; // a typo must not block 24/7
    }
    let cur = now.hour() * 60 + now.minute();
    let today = dow_index(now.weekday());
    if start < end {
        s.days.contains(&today) && cur >= start && cur < end
    } else if cur < end {
        // Cross-midnight: this belongs to the previous day's window.
        let prev = dow_index(now.weekday().pred());
        s.days.contains(&prev)
    } else {
        s.days.contains(&today) && cur >= start
    }
}

fn active_schedules(state: &BlockingState, now: chrono::DateTime<Local>) -> Vec<Schedule> {
    state.schedules.iter().filter(|s| is_schedule_active(s, now)).cloned().collect()
}

fn focus_active(state: &BlockingState, now_ms: u64) -> bool {
    state.focus.as_ref().map(|f| f.end_at > now_ms).unwrap_or(false)
}

/// Which application rules are active right now, and why. Mirrors
/// `evaluateBlocking` for the app half of the model.
fn active_app_rules(state: &BlockingState, usage: &Usage, owner: Option<&str>, sessions: &HashMap<String, HashMap<String, u64>>, remote_usage: &Usage) -> Vec<(Rule, String)> {
    let now_ms = now_ms();
    let today = Local::now();
    let running = active_schedules(state, today);
    let focus_on = state.settings.block_during_focus && focus_active(state, now_ms);

    let mut out = Vec::new();
    for rule in &state.rules {
        if !rule.enabled || rule.kind != "app" {
            continue;
        }
        let reason = match rule.when.as_str() {
            "always" => Some("always-on rule".to_string()),
            "focus" => focus_on.then(|| "focus session".to_string()),
            "scheduled" => {
                let hit: Vec<String> = running
                    .iter()
                    .filter(|s| rule.schedule_ids.is_empty() || rule.schedule_ids.contains(&s.id))
                    .map(|s| s.name.clone())
                    .collect();
                if hit.is_empty() { None } else { Some(format!("schedule: {}", hit.join(", "))) }
            }
            _ => None,
        };
        let Some(reason) = reason else { continue };

        // A temporary unblock wins until it expires — no cleanup needed after.
        if state
            .unblocks
            .get(&rule.id)
            .map(|until| *until > now_ms)
            .unwrap_or(false)
        {
            continue;
        }
        out.push((rule.clone(), reason));
    }
    if let Some(owner) = owner {
        let day = utc_day(now_ms);
        let local = usage.get(owner).and_then(|days| days.get(&day));
        let remote = remote_usage.get(owner).and_then(|days| days.get(&day));
        for limit in state.usage_limits.iter().filter(|limit| limit.enabled && limit.kind == "app" && limit.mode == "daily" && limit.daily_limit_minutes > 0) {
            let used: u64 = local.into_iter().chain(remote).flat_map(|apps| apps.iter())
                .filter(|(name, _)| app_key(name) == app_key(&limit.target))
                .map(|(_, seconds)| *seconds)
                .sum();
            if used < u64::from(limit.daily_limit_minutes) * 60
                || state.unblocks.get(&limit.id).map(|until| *until > now_ms).unwrap_or(false)
            { continue; }
            out.push((Rule {
                id: limit.id.clone(), kind: "app".into(), target: limit.target.clone(), label: limit.target.clone(),
                enabled: true, when: "always".into(), schedule_ids: Vec::new(),
            }, "daily usage limit".into()));
        }
    }
    if let Some(used) = owner.and_then(|id| sessions.get(id)) {
        for limit in state.usage_limits.iter().filter(|limit| limit.enabled && limit.kind == "app" && limit.mode == "session" && limit.daily_limit_minutes > 0) {
            if used.get(&app_key(&limit.target)).copied().unwrap_or(0) < u64::from(limit.daily_limit_minutes) * 60
                || state.unblocks.get(&limit.id).map(|until| *until > now_ms).unwrap_or(false) { continue; }
            out.push((Rule { id: limit.id.clone(), kind: "app".into(), target: limit.target.clone(), label: limit.target.clone(), enabled: true, when: "always".into(), schedule_ids: Vec::new() }, "session usage limit".into()));
        }
    }
    out
}

// ── persistence ───────────────────────────────────────────────────────────
fn load(path: &PathBuf) -> BlockingState {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BlockingState>(&raw).ok())
        .unwrap_or_default()
}

fn persist(state: &Arc<AppState>, next: &BlockingState) -> R<()> {
    let json = serde_json::to_string_pretty(next).map_err(|e| e.to_string())?;
    fs::write(&state.path, json).map_err(|e| format!("could not save rules: {e}"))
}

// ── process inspection ────────────────────────────────────────────────────
fn snapshot_processes() -> Vec<AppInfo> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut by_name: HashMap<String, Vec<u32>> = HashMap::new();
    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_string();
        if name.is_empty() || is_protected(&name) {
            continue;
        }
        by_name.entry(name).or_default().push(pid.as_u32());
    }
    let mut list: Vec<AppInfo> = by_name
        .into_iter()
        .map(|(name, mut pids)| {
            pids.sort_unstable();
            AppInfo { name, pids }
        })
        .collect();
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list
}

/// End every live process that matches an active app rule.
fn enforce(state: &Arc<AppState>) -> usize {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    {
        let mut sessions = state.session_usage.lock().unwrap();
        for used in sessions.values_mut() {
            used.retain(|name, _| sys.processes().values().any(|process| app_matches(&process.name().to_string_lossy(), name)));
        }
    }
    let active: Vec<(Rule, String)> = {
        let owner = state.usage_owner.lock().unwrap().clone();
        let usage = state.usage.lock().unwrap();
        let guard = state.blocking.lock().unwrap();
        active_app_rules(&guard, &usage, owner.as_deref(), &state.session_usage.lock().unwrap(), &state.remote_usage.lock().unwrap())
    };
    if active.is_empty() {
        return 0;
    }

    let mut killed = 0usize;
    let mut events: Vec<EnforcementEvent> = Vec::new();

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_string();
        if is_protected(&name) {
            continue;
        }
        for (rule, reason) in &active {
            if !app_matches(&name, &rule.target) {
                continue;
            }
            let ok = process.kill();
            if ok {
                killed += 1;
            }
            events.push(EnforcementEvent {
                at: now_ms(),
                name: name.clone(),
                pid: pid.as_u32(),
                rule: format!("{} ({reason})", rule.target),
                result: if ok { "killed".into() } else { "refused".into() },
            });
            break; // one rule is enough to justify acting on this process
        }
    }

    if !events.is_empty() {
        let mut log = state.events.lock().unwrap();
        log.extend(events);
        let len = log.len();
        if len > 50 {
            log.drain(0..len - 50);
        }
    }
    killed
}

// ── commands ──────────────────────────────────────────────────────────────
fn oauth_callback(target: &str, nonce: &str) -> Option<(String, String)> {
    let url = tauri::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != format!("/north-auth/{nonce}") { return None; }
    let code = url.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.into_owned()).unwrap_or_default();
    let error = url.query_pairs().find(|(key, _)| key == "error").map(|(_, value)| value.into_owned()).unwrap_or_default();
    if code.is_empty() && error.is_empty() { return None; }
    Some((code, error))
}

#[tauri::command]
fn begin_google_auth(app: tauri::AppHandle, nonce: String) -> R<String> {
    if nonce.len() != 36 || !nonce.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-') {
        return Err("Invalid sign-in request".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "Could not start local sign-in".to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let callback = format!("http://127.0.0.1:{}/north-auth/{nonce}", address.port());
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        while std::time::Instant::now() < deadline {
            let Ok((mut stream, _)) = listener.accept() else { std::thread::sleep(Duration::from_millis(100)); continue; };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buffer = [0u8; 8192];
            let Ok(size) = stream.read(&mut buffer) else { continue; };
            let request = String::from_utf8_lossy(&buffer[..size]);
            let mut parts = request.split_whitespace();
            let method = parts.next().unwrap_or("");
            let target = parts.next().unwrap_or("");
            let result = if method == "GET" { oauth_callback(target, &nonce) } else { None };
            let (status, body) = if result.is_some() {
                ("200 OK", "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>North Desktop</title><body style='margin:0;background:#191b24;color:#f8f9fc;font:16px system-ui;padding:48px'><h1>Return to North Desktop</h1><p>Your sign-in response has been received. Continue in the app.</p></body>")
            } else { ("404 Not Found", "Not found") };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = stream.write_all(response.as_bytes());
            if let Some((code, error)) = result {
                let _ = app.emit("north-oauth-return", serde_json::json!({ "nonce": nonce, "code": code, "error": error }));
                break;
            }
        }
    });
    Ok(callback)
}

#[tauri::command]
fn open_google_auth(url: String) -> R<()> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid sign-in URL".to_string())?;
    if parsed.scheme() != "https" || !parsed.host_str().unwrap_or("").ends_with(".supabase.co")
        || parsed.path() != "/auth/v1/authorize" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Invalid sign-in URL".into());
    }
    if parsed.query_pairs().find(|(key, value)| key == "provider" && value == "google").is_none() {
        return Err("Invalid sign-in provider".into());
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result.map(|_| ()).map_err(|_| "Could not open the browser. Please try again.".into())
}

#[tauri::command]
fn get_state(state: Ctx<'_>) -> BlockingState {
    state.blocking.lock().unwrap().clone()
}

#[tauri::command]
fn apply_account_blocking(
    state: Ctx<'_>, rules: Vec<Rule>, schedules: Vec<Schedule>, usage_limits: Vec<UsageLimit>,
    settings: Settings, focus: Option<Focus>,
) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    guard.rules.retain(|rule| rule.kind != "app");
    guard.rules.extend(rules.into_iter().filter(|rule| rule.kind == "app" && !normalize_app(&rule.target).is_empty()));
    guard.schedules = schedules;
    guard.usage_limits = usage_limits;
    guard.settings = settings;
    guard.focus = focus.filter(|f| f.end_at > now_ms());
    let active_ids: std::collections::HashSet<String> = guard.rules.iter().map(|rule| rule.id.clone())
        .chain(guard.usage_limits.iter().map(|limit| limit.id.clone())).collect();
    guard.unblocks.retain(|id, _| active_ids.contains(id));
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn add_block_rule(state: Ctx<'_>, name: String, when: Option<String>) -> R<Rule> {
    let target = normalize_app(&name);
    if target.is_empty() {
        return Err("Give the application a name".into());
    }
    let mut guard = state.blocking.lock().unwrap();
    if guard.rules.iter().any(|r| r.kind == "app" && app_key(&r.target) == app_key(&target)) {
        return Err(format!("{target} is already on the list"));
    }
    let rule = Rule {
        id: new_id("a"),
        kind: "app".into(),
        target: target.clone(),
        label: target,
        enabled: true,
        when: when.unwrap_or_else(|| "always".into()),
        schedule_ids: Vec::new(),
    };
    guard.rules.push(rule.clone());
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    Ok(rule)
}

#[tauri::command]
fn remove_block_rule(state: Ctx<'_>, id: String) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    guard.rules.retain(|r| r.id != id);
    guard.unblocks.remove(&id);
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn set_rule_enabled(state: Ctx<'_>, id: String, enabled: bool) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    for rule in guard.rules.iter_mut() {
        if rule.id == id {
            rule.enabled = enabled;
        }
    }
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn set_rule_when(state: Ctx<'_>, id: String, when: String) -> R<()> {
    if !["always", "focus", "scheduled"].contains(&when.as_str()) {
        return Err("unknown rule timing".into());
    }
    let mut guard = state.blocking.lock().unwrap();
    for rule in guard.rules.iter_mut() {
        if rule.id == id {
            rule.when = when.clone();
        }
    }
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn set_rule_schedules(state: Ctx<'_>, id: String, schedule_ids: Vec<String>) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    for rule in guard.rules.iter_mut() {
        if rule.id == id {
            rule.schedule_ids = schedule_ids.clone();
        }
    }
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn unblock_rule(state: Ctx<'_>, id: String, minutes: Option<u32>) -> R<u64> {
    let mut guard = state.blocking.lock().unwrap();
    let mins = minutes.unwrap_or(guard.settings.temp_unblock_minutes).max(1) as u64;
    let until = now_ms() + mins * 60_000;
    guard.unblocks.insert(id.clone(), until);
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    Ok(until)
}

#[tauri::command]
fn add_schedule(
    state: Ctx<'_>,
    name: String,
    days: Vec<u8>,
    start: String,
    end: String,
) -> R<Schedule> {
    if minutes_of(&start).is_none() || minutes_of(&end).is_none() {
        return Err("Times must look like 09:00".into());
    }
    if start == end {
        return Err("Start and end must differ".into());
    }
    let days: Vec<u8> = days.into_iter().filter(|d| *d <= 6).collect();
    if days.is_empty() {
        return Err("Pick at least one day".into());
    }
    let schedule = Schedule {
        id: new_id("s"),
        name: if name.trim().is_empty() { "Schedule".into() } else { name.trim().to_string() },
        days,
        start,
        end,
        enabled: true,
    };
    let mut guard = state.blocking.lock().unwrap();
    guard.schedules.push(schedule.clone());
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    Ok(schedule)
}

#[tauri::command]
fn remove_schedule(state: Ctx<'_>, id: String) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    guard.schedules.retain(|s| s.id != id);
    // A rule pointing at a deleted schedule would silently stop blocking.
    for rule in guard.rules.iter_mut() {
        rule.schedule_ids.retain(|sid| sid != &id);
    }
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)
}

#[tauri::command]
fn list_running_apps(state: Ctx<'_>) -> Status {
    let usage_owner = state.usage_owner.lock().unwrap().clone();
    let usage = state.usage.lock().unwrap();
    let guard = state.blocking.lock().unwrap();
    let active = active_app_rules(&guard, &usage, usage_owner.as_deref(), &state.session_usage.lock().unwrap(), &state.remote_usage.lock().unwrap());
    let now = Local::now();
    let running: Vec<String> = active_schedules(&guard, now).iter().map(|s| s.name.clone()).collect();
    let focus = focus_active(&guard, now_ms());
    let seconds_left = guard
        .focus
        .as_ref()
        .map(|f| f.end_at.saturating_sub(now_ms()) / 1000)
        .unwrap_or(0);
    Status {
        active: !active.is_empty(),
        reason: active.first().map(|(_, r)| r.clone()).unwrap_or_default(),
        focus_active: focus,
        focus_seconds_left: seconds_left,
        blocking_apps: active.iter().map(|(rule, _)| rule.target.clone()).collect(),
        running_apps: snapshot_processes(),
        running_schedules: running,
    }
}

#[tauri::command]
fn enforcement_log(state: Ctx<'_>) -> Vec<EnforcementEvent> {
    state.events.lock().unwrap().clone()
}

#[tauri::command]
fn set_usage_owner(state: Ctx<'_>, owner: Option<String>) {
    *state.usage_owner.lock().unwrap() = owner;
}

#[tauri::command]
fn set_remote_usage(state: Ctx<'_>, owner: String, day: String, usage: HashMap<String, u64>) {
    if state.usage_owner.lock().unwrap().as_deref() != Some(owner.as_str()) || day != utc_day(now_ms()) { return; }
    state.remote_usage.lock().unwrap().insert(owner, HashMap::from([(day, usage)]));
}

#[tauri::command]
fn desktop_usage(state: Ctx<'_>, owner: String) -> Vec<UsageRow> {
    if state.usage_owner.lock().unwrap().as_deref() != Some(owner.as_str()) { return Vec::new(); }
    let usage = state.usage.lock().unwrap();
    let hourly_usage = state.hourly_usage.lock().unwrap();
    let mut rows = Vec::new();
    if let Some(days) = usage.get(&owner) {
        for (day, apps) in days {
            for (name, seconds) in apps {
                if is_protected(name) { continue; }
                let hourly = hourly_usage.get(&owner).and_then(|days| days.get(day))
                    .and_then(|apps| apps.get(name)).cloned().unwrap_or_default();
                rows.push(UsageRow { day: day.clone(), name: name.clone(), seconds: *seconds, hourly });
            }
        }
    }
    rows
}

#[tauri::command]
fn start_focus(state: Ctx<'_>, minutes: u32, app: tauri::AppHandle) -> R<Focus> {
    let minutes = minutes.clamp(1, 480);
    let focus = Focus { started_at: now_ms(), minutes, end_at: now_ms() + minutes as u64 * 60_000 };
    let mut guard = state.blocking.lock().unwrap();
    guard.focus = Some(focus.clone());
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&format!("NORTH — focusing, {minutes}m left")));
    }
    Ok(focus)
}

#[tauri::command]
fn cancel_focus(state: Ctx<'_>, app: tauri::AppHandle) -> R<()> {
    let mut guard = state.blocking.lock().unwrap();
    guard.focus = None;
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("NORTH"));
    }
    Ok(())
}

#[tauri::command]
fn get_focus_state(state: Ctx<'_>) -> serde_json::Value {
    let guard = state.blocking.lock().unwrap();
    let left = guard
        .focus
        .as_ref()
        .map(|f| f.end_at.saturating_sub(now_ms()))
        .unwrap_or(0);
    serde_json::json!({ "running": left > 0, "secondsLeft": left / 1000 })
}

/// Link this device to a NORTH account. Identity only for now: rules live in a
/// local JSON file until the Supabase phase (SETUP.md) makes them travel.
#[tauri::command]
fn link_account(state: Ctx<'_>, un: String) -> R<String> {
    let un = un.trim().to_lowercase();
    if un.is_empty() {
        return Err("Enter the username from the web app".into());
    }
    let mut guard = state.blocking.lock().unwrap();
    guard.account = Some(un.clone());
    let next = guard.clone();
    drop(guard);
    persist(&state, &next)?;
    Ok(un)
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            // Rules live beside the app's other config, one file per device.
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&dir);
            let path = dir.join("north-blocking.json");
            let usage_path = dir.join("north-usage.json");
            let hourly_usage_path = dir.join("north-usage-hourly.json");
            let state = Arc::new(AppState {
                blocking: Mutex::new(load(&path)),
                events: Mutex::new(Vec::new()),
                usage: Mutex::new(load_usage(&usage_path)),
                hourly_usage: Mutex::new(fs::read(&hourly_usage_path).ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()),
                session_usage: Mutex::new(HashMap::new()),
                remote_usage: Mutex::new(load_usage(&usage_path.with_file_name("north-remote-usage.json"))),
                usage_owner: Mutex::new(None),
                path,
                usage_path,
                hourly_usage_path,
            });
            app.manage(state.clone());
            #[cfg(target_os = "windows")]
            {
                let usage_state = app.state::<Arc<AppState>>().inner().clone();
                let usage_app = app.handle().clone();
                std::thread::spawn(move || {
                    let mut ticks = 0u8;
                    loop {
                        let started = std::time::Instant::now();
                        std::thread::sleep(Duration::from_secs(1));
                        // Do not charge the first sample after sleep/hibernation.
                        if started.elapsed() < Duration::from_secs(2) {
                            sample_foreground_usage(&usage_state);
                        }
                        ticks += 1;
                        if ticks == 10 {
                            ticks = 0;
                            save_usage(&usage_state);
                            // Native events keep account sync awake in the tray.
                            let _ = usage_app.emit("north-desktop-tick", ());
                        }
                    }
                });
            }

            // Enforcement loop. 3s is a deliberate compromise: fast enough that
            // a distraction does not survive long, slow enough that scanning
            // the process table stays negligible.
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3));
                let _ = enforce(&state);
            });

            let open = MenuItem::with_id(app, "open", "Open NORTH", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main").menu(&menu);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "quit" => {
                    save_usage(app.state::<Arc<AppState>>().inner());
                    app.exit(0);
                },
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            begin_google_auth,
            open_google_auth,
            get_state,
            apply_account_blocking,
            get_focus_state,
            start_focus,
            cancel_focus,
            add_block_rule,
            remove_block_rule,
            set_rule_enabled,
            set_rule_when,
            set_rule_schedules,
            unblock_rule,
            add_schedule,
            remove_schedule,
            list_running_apps,
            enforcement_log,
            desktop_usage,
            set_remote_usage,
            set_usage_owner,
            link_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running NORTH");
}

#[cfg(test)]
mod tests {
    use super::{oauth_callback, app_matches, active_app_rules, BlockingState, UsageLimit, Usage, utc_day, now_ms};
    use std::collections::HashMap;

    #[test]
    fn daily_and_session_allowances_are_account_scoped() {
        let mut state = BlockingState::default();
        state.usage_limits.push(UsageLimit { id: "limit".into(), kind: "app".into(), target: "notepad".into(), mode: "daily".into(), daily_limit_minutes: 1, enabled: true });
        let usage = Usage::from([("alice".into(), HashMap::from([(utc_day(now_ms()), HashMap::from([("notepad".into(), 30)]))]))]);
        let remote = Usage::from([("alice".into(), HashMap::from([(utc_day(now_ms()), HashMap::from([("notepad".into(), 40)]))]))]);
        let sessions = HashMap::from([("alice".into(), HashMap::from([("notepad".into(), 60)]))]);
        assert_eq!(active_app_rules(&state, &usage, Some("alice"), &sessions, &remote).len(), 1);
        assert!(active_app_rules(&state, &usage, Some("bob"), &sessions, &remote).is_empty());
        state.usage_limits[0].mode = "session".into();
        assert_eq!(active_app_rules(&state, &Usage::new(), Some("alice"), &sessions, &Usage::new()).len(), 1);
        assert!(active_app_rules(&state, &usage, Some("alice"), &HashMap::new(), &remote).is_empty());
    }

    #[test]
    fn app_rules_match_only_the_named_executable() {
        assert!(app_matches("Notepad.EXE", "notepad"));
        assert!(!app_matches("notepad++", "notepad"));
        assert!(!app_matches("application", "app"));
        assert!(!app_matches("notepad", ""));
    }

    #[test]
    fn oauth_callback_requires_the_exact_nonce_path_and_a_result() {
        let nonce = "12345678-1234-1234-1234-123456789abc";
        assert_eq!(
            oauth_callback(
                &format!("/north-auth/{nonce}?code=one-use-code"),
                nonce,
            ),
            Some(("one-use-code".into(), "".into()))
        );
        assert_eq!(
            oauth_callback(
                &format!("/north-auth/{nonce}?error=access_denied"),
                nonce,
            ),
            Some(("".into(), "access_denied".into()))
        );
        assert_eq!(oauth_callback("/north-auth/wrong?code=leak", nonce), None);
        assert_eq!(oauth_callback(&format!("/north-auth/{nonce}"), nonce), None);
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
