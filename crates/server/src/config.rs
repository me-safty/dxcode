#![allow(clippy::struct_excessive_bools)]

use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct ServerRuntimeConfig {
    pub cwd: PathBuf,
    pub web_dist_dir: PathBuf,
    pub ws_token: String,
    pub logs_dir: PathBuf,
}
