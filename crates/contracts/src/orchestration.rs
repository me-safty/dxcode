use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum ProviderKind {
    Codex,
    #[serde(rename = "claudeAgent")]
    #[ts(rename = "claudeAgent")]
    ClaudeAgent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ModelSelection {
    pub provider: ProviderKind,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ProjectScript {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub run_on_worktree_create: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationProject {
    pub id: String,
    pub title: String,
    pub workspace_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_selection: Option<ModelSelection>,
    pub scripts: Vec<ProjectScript>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct ChatAttachment {
    pub r#type: String,
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<ChatAttachment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub streaming: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationProposedPlan {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub plan_markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implemented_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_thread_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationThreadActivity {
    pub id: String,
    pub tone: String,
    pub kind: String,
    pub summary: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationCheckpointFile {
    pub path: String,
    pub kind: String,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationCheckpointSummary {
    pub turn_id: String,
    pub checkpoint_turn_count: u64,
    pub checkpoint_ref: String,
    pub status: String,
    pub files: Vec<OrchestrationCheckpointFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant_message_id: Option<String>,
    pub completed_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct SourceProposedPlanReference {
    pub thread_id: String,
    pub plan_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationLatestTurn {
    pub turn_id: String,
    pub state: String,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_proposed_plan: Option<SourceProposedPlanReference>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationSession {
    pub thread_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    pub runtime_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationThread {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub model_selection: ModelSelection,
    pub runtime_mode: String,
    pub interaction_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn: Option<OrchestrationLatestTurn>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    pub messages: Vec<OrchestrationMessage>,
    pub proposed_plans: Vec<OrchestrationProposedPlan>,
    pub activities: Vec<OrchestrationThreadActivity>,
    pub checkpoints: Vec<OrchestrationCheckpointSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<OrchestrationSession>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationReadModel {
    pub snapshot_sequence: u64,
    pub projects: Vec<OrchestrationProject>,
    pub threads: Vec<OrchestrationThread>,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct OrchestrationEvent {
    pub sequence: u64,
    pub event_id: String,
    pub aggregate_kind: String,
    pub aggregate_id: String,
    pub occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub metadata: serde_json::Value,
    pub r#type: String,
    pub payload: serde_json::Value,
}
