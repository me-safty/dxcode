/**
 * Old (core fork) -> new (plugin-namespaced) object names for the workflow-boards
 * schema. Prefix is fixed by the migrator gate: pluginSqlPrefix("workflow-boards")
 * === "p_workflow_boards_". `workflow_notification_outbox` is intentionally absent
 * (notifications dropped in v1).
 */
const TABLE_RENAME_MAP = {
  workflow_events: "p_workflow_boards_events",
  projection_board: "p_workflow_boards_projection_board",
  projection_ticket: "p_workflow_boards_projection_ticket",
  projection_pipeline_run: "p_workflow_boards_projection_pipeline_run",
  projection_step_run: "p_workflow_boards_projection_step_run",
  projection_ticket_message: "p_workflow_boards_projection_ticket_message",
  projection_ticket_dependency: "p_workflow_boards_projection_ticket_dependency",
  worktree_lease: "p_workflow_boards_worktree_lease",
  workflow_dispatch_outbox: "p_workflow_boards_dispatch_outbox",
  workflow_setup_run: "p_workflow_boards_setup_run",
  workflow_script_run: "p_workflow_boards_script_run",
  workflow_project_trust: "p_workflow_boards_project_trust",
  workflow_board_version: "p_workflow_boards_board_version",
  workflow_board_webhook: "p_workflow_boards_board_webhook",
  workflow_webhook_delivery: "p_workflow_boards_webhook_delivery",
  workflow_pr_state: "p_workflow_boards_pr_state",
  workflow_pr_observation: "p_workflow_boards_pr_observation",
  work_source_connection: "p_workflow_boards_work_source_connection",
  work_source_mapping: "p_workflow_boards_work_source_mapping",
  work_source_state: "p_workflow_boards_work_source_state",
  workflow_outbound_connection: "p_workflow_boards_outbound_connection",
  workflow_outbound_delivery: "p_workflow_boards_outbound_delivery",
  workflow_board_proposal: "p_workflow_boards_board_proposal",
  workflow_agent_session: "p_workflow_boards_agent_session",
} as const;

const INDEX_RENAME_MAP = {
  idx_workflow_events_stream_version: "p_workflow_boards_idx_workflow_events_stream_version",
  idx_workflow_events_ticket_type_time: "p_workflow_boards_idx_workflow_events_ticket_type_time",
  idx_projection_ticket_board: "p_workflow_boards_idx_projection_ticket_board",
  idx_projection_step_run_ticket: "p_workflow_boards_idx_projection_step_run_ticket",
  idx_projection_step_run_status_type: "p_workflow_boards_idx_projection_step_run_status_type",
  idx_projection_ticket_lane_admission: "p_workflow_boards_idx_projection_ticket_lane_admission",
  idx_projection_ticket_lane_queue: "p_workflow_boards_idx_projection_ticket_lane_queue",
  idx_projection_ticket_message_ticket: "p_workflow_boards_idx_projection_ticket_message_ticket",
  idx_projection_ticket_terminal_retention:
    "p_workflow_boards_idx_projection_ticket_terminal_retention",
  idx_projection_ticket_dependency_depends_on:
    "p_workflow_boards_idx_projection_ticket_dependency_depends_on",
  idx_dispatch_outbox_pending: "p_workflow_boards_idx_dispatch_outbox_pending",
  idx_dispatch_outbox_step_run: "p_workflow_boards_idx_dispatch_outbox_step_run",
  idx_workflow_script_run_ticket: "p_workflow_boards_idx_workflow_script_run_ticket",
  idx_workflow_script_run_status: "p_workflow_boards_idx_workflow_script_run_status",
  idx_workflow_board_version_board: "p_workflow_boards_idx_workflow_board_version_board",
  idx_workflow_board_version_hash: "p_workflow_boards_idx_workflow_board_version_hash",
  idx_workflow_pr_state_open: "p_workflow_boards_idx_workflow_pr_state_open",
  idx_workflow_pr_observation_pending: "p_workflow_boards_idx_workflow_pr_observation_pending",
  idx_workflow_outbound_delivery_due: "p_workflow_boards_idx_workflow_outbound_delivery_due",
  idx_work_source_mapping_external: "p_workflow_boards_idx_work_source_mapping_external",
  idx_work_source_mapping_ticket: "p_workflow_boards_idx_work_source_mapping_ticket",
  idx_workflow_board_proposal_board: "p_workflow_boards_idx_workflow_board_proposal_board",
  idx_workflow_agent_session_ticket: "p_workflow_boards_idx_workflow_agent_session_ticket",
  idx_workflow_agent_session_thread: "p_workflow_boards_idx_workflow_agent_session_thread",
} as const;

export const RENAME_MAP: Readonly<Record<string, string>> = {
  ...TABLE_RENAME_MAP,
  ...INDEX_RENAME_MAP,
} as const;

/** The table names this plugin owns (for smoke-test membership + count checks; order-independent). */
export const OWNED_TABLES: ReadonlyArray<string> = Object.values(TABLE_RENAME_MAP);

/** The index names this plugin owns (for smoke-test membership + count checks; order-independent). */
export const OWNED_INDEXES: ReadonlyArray<string> = Object.values(INDEX_RENAME_MAP);
