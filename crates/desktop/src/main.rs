#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(clippy::all, clippy::pedantic)]

mod bridge;
mod commands;
mod state;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use tauri::http::{Response as TauriResponse, StatusCode};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing_subscriber::EnvFilter;

use crate::bridge::desktop_bridge_script;
use crate::state::DesktopState;
use t3code_server::config::ServerRuntimeConfig;
use t3code_server::{load_protocol_asset, spawn, AppState as EmbeddedServerState};

fn main() {
    if let Err(error) = run() {
        eprintln!("desktop startup failed: {error:?}");
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let repo_root = workspace_root()?;
    let web_dist_dir = repo_root.join("apps/web/dist");
    let logs_dir = default_logs_dir()?;
    std::fs::create_dir_all(&logs_dir)
        .with_context(|| format!("failed to create {}", logs_dir.display()))?;

    let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0"))
        .context("failed to bind loopback listener")?;
    let local_addr = listener
        .local_addr()
        .context("failed to read local address")?;
    let token = generate_auth_token();
    let ws_url = format!("ws://127.0.0.1:{}/ws?token={token}", local_addr.port());

    let server_handle = spawn(
        listener,
        ServerRuntimeConfig {
            cwd: repo_root.clone(),
            web_dist_dir,
            ws_token: token,
            logs_dir: logs_dir.clone(),
        },
    )?;

    let desktop_state = DesktopState {
        ws_url: ws_url.clone(),
        server_handle: Arc::new(Mutex::new(Some(server_handle))),
    };

    let bridge_script = desktop_bridge_script(&ws_url);
    let app_state_for_protocol = EmbeddedServerState::new(ServerRuntimeConfig {
        cwd: repo_root,
        web_dist_dir: workspace_root()?.join("apps/web/dist"),
        ws_token: String::new(),
        logs_dir,
    });

    let app = tauri::Builder::default()
        .manage(desktop_state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::confirm,
            commands::set_theme,
            commands::open_external,
            commands::get_ws_url,
            commands::show_context_menu
        ])
        .register_uri_scheme_protocol("t3", move |_app, request| {
            let path = request.uri().path().trim_start_matches('/');
            let load_result = tauri::async_runtime::block_on(load_protocol_asset(
                &app_state_for_protocol,
                path,
                Some(&bridge_script),
            ));

            match load_result {
                Ok((body, content_type)) => TauriResponse::builder()
                    .status(StatusCode::OK)
                    .header("content-type", content_type)
                    .body(body)
                    .expect("protocol response should build"),
                Err(error) => TauriResponse::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header("content-type", "text/plain; charset=utf-8")
                    .body(format!("Unable to load frontend asset: {error}").into_bytes())
                    .expect("error response should build"),
            }
        })
        .setup(|app| {
            let url = "t3://app/index.html"
                .parse()
                .context("invalid custom protocol url")?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("T3 Code")
                .inner_size(1440.0, 920.0)
                .build()
                .context("failed to build main window")?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();

            if let Some(state) = app_handle.try_state::<DesktopState>() {
                let server_handle = state.server_handle.clone();
                tauri::async_runtime::block_on(async move {
                    if let Some(server_handle) = server_handle.lock().await.take() {
                        let _ = server_handle.shutdown().await;
                    }
                });
            }

            app_handle.exit(0);
        }
    });

    Ok(())
}

fn workspace_root() -> anyhow::Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .and_then(std::path::Path::parent)
        .and_then(std::path::Path::parent)
        .context("desktop crate should live under crates/desktop")?;
    Ok(root.to_path_buf())
}

fn default_logs_dir() -> anyhow::Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME is not set")?;
    Ok(PathBuf::from(home).join(".t3/userdata/logs"))
}

fn generate_auth_token() -> String {
    let first = uuid::Uuid::new_v4().simple().to_string();
    let second = uuid::Uuid::new_v4().simple().to_string();
    format!("{first}{second}").chars().take(48).collect()
}
