use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use t3code_server::ServerHandle;

#[derive(Clone)]
pub struct DesktopState {
    pub ws_url: String,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextMenuItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub destructive: bool,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}
