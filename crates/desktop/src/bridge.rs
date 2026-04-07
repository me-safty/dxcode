pub fn desktop_bridge_script(ws_url: &str) -> String {
    let ws_url_json = serde_json::to_string(ws_url).unwrap_or_else(|_| "\"\"".to_owned());
    let update_state = serde_json::json!({
        "enabled": false,
        "status": "disabled",
        "currentVersion": "0.1.0",
        "hostArch": "other",
        "appArch": "other",
        "runningUnderArm64Translation": false,
        "availableVersion": null,
        "downloadedVersion": null,
        "downloadPercent": null,
        "checkedAt": null,
        "message": null,
        "errorContext": null,
        "canRetry": false
    });
    let update_state_json =
        serde_json::to_string(&update_state).unwrap_or_else(|_| "{}".to_owned());

    format!(
        r#"
(() => {{
  const wsUrl = {ws_url_json};
  const defaultUpdateState = {update_state_json};
  const invoke = (command, args) => {{
    const tauri = window.__TAURI_INTERNALS__;
    if (!tauri || typeof tauri.invoke !== "function") {{
      return Promise.reject(new Error("Tauri invoke is unavailable."));
    }}
    return tauri.invoke(command, args);
  }};

  window.desktopBridge = {{
    getWsUrl: () => wsUrl,
    pickFolder: () => invoke("pick_folder"),
    confirm: (message) => invoke("confirm", {{ message }}),
    setTheme: (theme) => invoke("set_theme", {{ theme }}),
    showContextMenu: (items, position) => invoke("show_context_menu", {{ items, position }}),
    openExternal: (url) => invoke("open_external", {{ url }}),
    onMenuAction: () => () => {{}},
    getUpdateState: async () => defaultUpdateState,
    checkForUpdate: async () => ({{ checked: false, state: defaultUpdateState }}),
    downloadUpdate: async () => ({{ accepted: false, completed: false, state: defaultUpdateState }}),
    installUpdate: async () => ({{ accepted: false, completed: false, state: defaultUpdateState }}),
    onUpdateState: () => () => {{}},
  }};
}})();
"#
    )
}
