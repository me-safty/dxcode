use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::orchestration::{ModelSelection, ProviderKind};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfigIssue {
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerProviderAuth {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerProviderModel {
    pub slug: String,
    pub name: String,
    pub is_custom: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerProvider {
    pub provider: ProviderKind,
    pub enabled: bool,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub status: String,
    pub auth: ServerProviderAuth,
    pub checked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub models: Vec<ServerProviderModel>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerObservability {
    pub logs_directory_path: String,
    pub local_tracing_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub otlp_traces_url: Option<String>,
    pub otlp_traces_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub otlp_metrics_url: Option<String>,
    pub otlp_metrics_enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct CodexSettings {
    pub enabled: bool,
    pub binary_path: String,
    pub home_path: String,
    pub custom_models: Vec<String>,
}

impl Default for CodexSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            binary_path: "codex".to_owned(),
            home_path: String::new(),
            custom_models: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ClaudeSettings {
    pub enabled: bool,
    pub binary_path: String,
    pub custom_models: Vec<String>,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            binary_path: "claude".to_owned(),
            custom_models: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ProviderSettings {
    pub codex: CodexSettings,
    pub claude_agent: ClaudeSettings,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ObservabilitySettings {
    pub otlp_traces_url: String,
    pub otlp_metrics_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerSettings {
    pub enable_assistant_streaming: bool,
    pub default_thread_env_mode: String,
    pub text_generation_model_selection: ModelSelection,
    pub providers: ProviderSettings,
    pub observability: ObservabilitySettings,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self {
            enable_assistant_streaming: false,
            default_thread_env_mode: "local".to_owned(),
            text_generation_model_selection: ModelSelection {
                provider: ProviderKind::Codex,
                model: "gpt-5.4-mini".to_owned(),
                options: None,
            },
            providers: ProviderSettings::default(),
            observability: ObservabilitySettings::default(),
        }
    }
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct KeybindingShortcut {
    pub key: String,
    pub meta_key: bool,
    pub ctrl_key: bool,
    pub shift_key: bool,
    pub alt_key: bool,
    pub mod_key: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ResolvedKeybindingRule {
    pub command: String,
    pub shortcut: KeybindingShortcut,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when_ast: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfig {
    pub cwd: String,
    pub keybindings_config_path: String,
    pub keybindings: Vec<ResolvedKeybindingRule>,
    pub issues: Vec<ServerConfigIssue>,
    pub providers: Vec<ServerProvider>,
    pub available_editors: Vec<String>,
    pub observability: ServerObservability,
    pub settings: ServerSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerUpsertKeybindingResult {
    pub keybindings: Vec<ResolvedKeybindingRule>,
    pub issues: Vec<ServerConfigIssue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerProviderUpdatedPayload {
    pub providers: Vec<ServerProvider>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfigUpdatedPayload {
    pub issues: Vec<ServerConfigIssue>,
    pub providers: Vec<ServerProvider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<ServerSettings>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfigKeybindingsUpdatedPayload {
    pub issues: Vec<ServerConfigIssue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfigProviderStatusesPayload {
    pub providers: Vec<ServerProvider>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerConfigSettingsUpdatedPayload {
    pub settings: ServerSettings,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum ServerConfigStreamEvent {
    Snapshot {
        version: u8,
        config: ServerConfig,
    },
    KeybindingsUpdated {
        version: u8,
        payload: ServerConfigKeybindingsUpdatedPayload,
    },
    ProviderStatuses {
        version: u8,
        payload: ServerConfigProviderStatusesPayload,
    },
    SettingsUpdated {
        version: u8,
        payload: ServerConfigSettingsUpdatedPayload,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerLifecycleWelcomePayload {
    pub cwd: String,
    pub project_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_thread_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ServerLifecycleReadyPayload {
    pub at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum ServerLifecycleStreamEvent {
    Welcome {
        version: u8,
        sequence: u64,
        payload: ServerLifecycleWelcomePayload,
    },
    Ready {
        version: u8,
        sequence: u64,
        payload: ServerLifecycleReadyPayload,
    },
}
