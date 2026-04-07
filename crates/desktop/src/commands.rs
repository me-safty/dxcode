use tauri::{AppHandle, Manager, State, Theme};

use crate::state::{ContextMenuItem, DesktopState, Position};

#[tauri::command]
pub async fn pick_folder() -> Option<String> {
    None
}

#[tauri::command]
pub async fn confirm(message: String) -> bool {
    !message.trim().is_empty()
}

#[tauri::command]
pub async fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_owned())?;

    let next_theme = match theme.as_str() {
        "dark" => Theme::Dark,
        "light" | "system" => Theme::Light,
        _ => return Err("Unsupported theme.".to_owned()),
    };

    window
        .set_theme(Some(next_theme))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_external(url: String) -> bool {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return false;
    }

    #[cfg(target_os = "macos")]
    let program = ("open", vec![url.as_str()]);
    #[cfg(target_os = "linux")]
    let program = ("xdg-open", vec![url.as_str()]);
    #[cfg(target_os = "windows")]
    let program = ("cmd", vec!["/C", "start", "", url.as_str()]);

    std::process::Command::new(program.0)
        .args(program.1)
        .spawn()
        .is_ok()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn get_ws_url(state: State<'_, DesktopState>) -> String {
    state.ws_url.clone()
}

#[tauri::command]
pub async fn show_context_menu(
    _items: Vec<ContextMenuItem>,
    _position: Option<Position>,
) -> Option<String> {
    None
}
