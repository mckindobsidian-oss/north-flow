// NORTH desktop — Tauri 2 client.
//
// WHAT IS REAL HERE
//  - A window with the NORTH shell (static page in ../dist) plus a system tray.
//  - Block rules for applications, persisted as JSON in the app config dir.
//  - Process enumeration via `sysinfo`, and an enforcement loop that ENDS the
//    processes whose rules are active (always-on, during a focus session, or
//    inside a schedule window).
//  - Focus sessions with a wall-clock deadline, mirrored in the tray tooltip.
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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{Manager, State};

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
    path: PathBuf,
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
];

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
    !t.is_empty() && (p == t || p.contains(&t) || t.contains(&p))
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
fn active_app_rules(state: &BlockingState) -> Vec<(Rule, String)> {
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
    let active: Vec<(Rule, String)> = {
        let guard = state.blocking.lock().unwrap();
        active_app_rules(&guard)
    };
    if active.is_empty() {
        return 0;
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
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
#[tauri::command]
fn get_state(state: Ctx<'_>) -> BlockingState {
    state.blocking.lock().unwrap().clone()
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
    let guard = state.blocking.lock().unwrap();
    let active = active_app_rules(&guard);
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
            let state = Arc::new(AppState {
                blocking: Mutex::new(load(&path)),
                events: Mutex::new(Vec::new()),
                path,
            });
            app.manage(state.clone());

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
                "quit" => app.exit(0),
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
            get_state,
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
            link_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running NORTH");
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
