use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;
use ts_rs::TS;

use crate::orchestration::{
    ChatAttachment, ModelSelection, OrchestrationCheckpointFile, OrchestrationCheckpointSummary,
    OrchestrationEvent, OrchestrationLatestTurn, OrchestrationMessage, OrchestrationProject,
    OrchestrationProposedPlan, OrchestrationReadModel, OrchestrationSession, OrchestrationThread,
    OrchestrationThreadActivity, ProjectScript, ProviderKind, SourceProposedPlanReference,
};
use crate::rpc::{RpcCause, RpcExit, RpcInboundTag, RpcOutboundTag, RpcRequest, RpcServerMessage};
use crate::server::{
    ClaudeSettings, CodexSettings, KeybindingShortcut, ObservabilitySettings, ProviderSettings,
    ResolvedKeybindingRule, ServerConfig, ServerConfigIssue, ServerConfigKeybindingsUpdatedPayload,
    ServerConfigProviderStatusesPayload, ServerConfigSettingsUpdatedPayload,
    ServerConfigStreamEvent, ServerLifecycleReadyPayload, ServerLifecycleStreamEvent,
    ServerLifecycleWelcomePayload, ServerObservability, ServerProvider, ServerProviderAuth,
    ServerProviderModel, ServerProviderUpdatedPayload, ServerSettings,
    ServerUpsertKeybindingResult,
};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn workspace_root() -> anyhow::Result<PathBuf> {
    let crate_root = crate_root();
    let root = crate_root
        .parent()
        .and_then(Path::parent)
        .context("contracts crate should live under crates/contracts")?;
    Ok(root.to_path_buf())
}

fn temporary_generated_dir_candidates(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let current_dir = std::env::current_dir().context("failed to read current directory")?;
    Ok(vec![
        current_dir.join("bindings/packages/contracts-rust/generated"),
        root.join("bindings/packages/contracts-rust/generated"),
        crate_root().join("bindings/packages/contracts-rust/generated"),
    ])
}

fn reset_temporary_generated_dirs(paths: &[PathBuf]) -> anyhow::Result<()> {
    for path in paths {
        if let Some(bindings_root) = path.parent().and_then(Path::parent).and_then(Path::parent) {
            if bindings_root.exists() {
                fs::remove_dir_all(bindings_root)
                    .with_context(|| format!("failed to reset {}", bindings_root.display()))?;
            }
        }
    }

    Ok(())
}

fn locate_temporary_generated_dir(paths: &[PathBuf]) -> anyhow::Result<PathBuf> {
    paths
        .iter()
        .find(|path| path.exists())
        .cloned()
        .with_context(|| {
            format!(
                "failed to find generated bindings in any of: {}",
                paths
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

/// Exports all Rust websocket contract types to the generated TypeScript package.
///
/// # Errors
///
/// Returns an error if the workspace output directories cannot be created, if `ts-rs`
/// fails to emit one of the contract bindings, or if the generated files cannot be copied
/// into [`packages/contracts-rust`](../../../packages/contracts-rust).
pub fn export_bindings() -> anyhow::Result<()> {
    let root = workspace_root()?;
    let generated_dir = root.join("packages/contracts-rust/generated");
    let temporary_generated_dirs = temporary_generated_dir_candidates(&root)?;

    if generated_dir.exists() {
        fs::remove_dir_all(&generated_dir)
            .with_context(|| format!("failed to reset {}", generated_dir.display()))?;
    }
    reset_temporary_generated_dirs(&temporary_generated_dirs)?;

    fs::create_dir_all(&generated_dir)
        .with_context(|| format!("failed to create {}", generated_dir.display()))?;

    export_type::<ProviderKind>()?;
    export_type::<ModelSelection>()?;
    export_type::<ProjectScript>()?;
    export_type::<OrchestrationProject>()?;
    export_type::<ChatAttachment>()?;
    export_type::<OrchestrationMessage>()?;
    export_type::<OrchestrationProposedPlan>()?;
    export_type::<OrchestrationThreadActivity>()?;
    export_type::<OrchestrationCheckpointFile>()?;
    export_type::<OrchestrationCheckpointSummary>()?;
    export_type::<SourceProposedPlanReference>()?;
    export_type::<OrchestrationLatestTurn>()?;
    export_type::<OrchestrationSession>()?;
    export_type::<OrchestrationThread>()?;
    export_type::<OrchestrationReadModel>()?;
    export_type::<OrchestrationEvent>()?;
    export_type::<ServerConfigIssue>()?;
    export_type::<ServerProviderAuth>()?;
    export_type::<ServerProviderModel>()?;
    export_type::<ServerProvider>()?;
    export_type::<ServerObservability>()?;
    export_type::<CodexSettings>()?;
    export_type::<ClaudeSettings>()?;
    export_type::<ProviderSettings>()?;
    export_type::<ObservabilitySettings>()?;
    export_type::<ServerSettings>()?;
    export_type::<KeybindingShortcut>()?;
    export_type::<ResolvedKeybindingRule>()?;
    export_type::<ServerConfig>()?;
    export_type::<ServerUpsertKeybindingResult>()?;
    export_type::<ServerProviderUpdatedPayload>()?;
    export_type::<ServerConfigKeybindingsUpdatedPayload>()?;
    export_type::<ServerConfigProviderStatusesPayload>()?;
    export_type::<ServerConfigSettingsUpdatedPayload>()?;
    export_type::<ServerConfigStreamEvent>()?;
    export_type::<ServerLifecycleWelcomePayload>()?;
    export_type::<ServerLifecycleReadyPayload>()?;
    export_type::<ServerLifecycleStreamEvent>()?;
    export_type::<RpcInboundTag>()?;
    export_type::<RpcOutboundTag>()?;
    export_type::<RpcRequest>()?;
    export_type::<RpcCause>()?;
    export_type::<RpcExit>()?;
    export_type::<RpcServerMessage>()?;

    let temporary_generated_dir = locate_temporary_generated_dir(&temporary_generated_dirs)?;
    copy_generated_files(&temporary_generated_dir, &generated_dir)?;
    reset_temporary_generated_dirs(&temporary_generated_dirs)?;

    let package_index = root.join("packages/contracts-rust/src/index.ts");
    let mut files = fs::read_dir(&generated_dir)
        .with_context(|| format!("failed to read {}", generated_dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to collect generated entries")?;
    files.sort_by_key(std::fs::DirEntry::file_name);

    let exports = files
        .iter()
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            file_name
                .strip_suffix(".ts")
                .map(|stem| format!("export * from \"../generated/{stem}\";"))
        })
        .collect::<Vec<_>>()
        .join("\n");

    fs::write(
        package_index,
        format!(
            "// Generated by `sfw cargo run -p t3code-contracts --bin export_ts`.\n{exports}\n"
        ),
    )
    .context("failed to write contracts-rust index")?;

    Ok(())
}

fn export_type<T: TS + 'static>() -> anyhow::Result<()> {
    T::export().with_context(|| format!("failed to export {}", T::name()))
}

fn copy_generated_files(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    let entries = fs::read_dir(source_dir)
        .with_context(|| {
            format!(
                "failed to read generated bindings from {}",
                source_dir.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to collect generated binding entries")?;

    for entry in entries {
        let target_path = target_dir.join(entry.file_name());
        fs::copy(entry.path(), &target_path).with_context(|| {
            format!(
                "failed to copy generated binding {} to {}",
                entry.path().display(),
                target_path.display()
            )
        })?;
    }

    Ok(())
}
