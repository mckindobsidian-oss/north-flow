// Focusly desktop — Tauri 2 entry point.
//
// What is real today:
//  - A window with the Focusly UI (static shell in ../dist) + system tray
//    (click to reopen, quit from the menu).
//  - `start_focus` / `get_focus_state` commands the web UI can call; focus
//    bookkeeping is intentionally thin here — real focus state lives in the
//    shared backend once the Supabase phase lands, and the web app already
//    owns the timer.
//
// What is deliberately NOT here yet (no fake claims):
//  - OS-level app usage tracking & app blocking. That requires native work
//    (Windows: EnumWindows + process enumeration; macOS: NSWorkspace running
//    applications) and is the desktop client's next milestone. `block_app`
//    answers honestly until then.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, State};

struct FocusState(Mutex<Option<u64>>); // end-at epoch ms

#[tauri::command]
fn start_focus(minutes: u64, state: State<FocusState>, app: tauri::AppHandle) -> String {
    let end_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64 + minutes * 60_000)
        .unwrap_or(0);
    *state.0.lock().unwrap() = Some(end_at);
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&format!("Focusly — focusing, {}m left", minutes)));
    }
    format!("Focus session started for {} minutes", minutes)
}

#[tauri::command]
fn cancel_focus(state: State<FocusState>, app: tauri::AppHandle) -> String {
    *state.0.lock().unwrap() = None;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("Focusly"));
    }
    "Focus session ended".into()
}

#[tauri::command]
fn get_focus_state(state: State<FocusState>) -> serde_json::Value {
    let end_at = *state.0.lock().unwrap();
    let left = end_at
        .and_then(|end| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            end.checked_sub(now)
        })
        .unwrap_or(0);
    serde_json::json!({ "running": left > 0, "secondsLeft": (left / 1000) })
}

#[tauri::command]
fn block_app(name: String) -> Result<String, String> {
    Err(format!(
        "OS-level blocking for '{name}' is not implemented yet — app tracking & blocking land in the desktop milestone (Windows EnumWindows / macOS NSWorkspace)."
    ))
}

fn main() {
    tauri::Builder::default()
        .manage(FocusState(Mutex::new(None)))
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let open = MenuItem::with_id(app, "open", "Open Focusly", true, None::<&str>)?;
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
            start_focus,
            cancel_focus,
            get_focus_state,
            block_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Focusly");
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
