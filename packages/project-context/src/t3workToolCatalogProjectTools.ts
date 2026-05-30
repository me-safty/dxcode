import { definePlannedTools, type T3workToolCatalogEntry } from "./t3workToolCatalogCore.ts";

const PLANNED_PROJECT_BACKLOG_MY_WORK_TOOL_ENTRIES = [
  ...definePlannedTools({
    kind: "read",
    surfaces: ["project"],
    ids: [
      "t3work.project.attach_context_bundle",
      "t3work.project.refresh_context_bundle",
      "t3work.project.list_linked_repositories",
    ],
  }),
  ...definePlannedTools({
    kind: "view-state",
    surfaces: ["project"],
    ids: [
      "t3work.project.open_dashboard_mode",
      "t3work.project.open_linked_repository_manager",
      "t3work.project.refresh_integrations",
    ],
  }),
  ...definePlannedTools({
    kind: "thread",
    surfaces: ["project"],
    ids: ["t3work.project.create_context_bound_thread"],
  }),
  ...definePlannedTools({
    kind: "read",
    surfaces: ["backlog"],
    ids: [
      "t3work.backlog.attach_view_context",
      "t3work.backlog.refresh_view_context",
      "t3work.backlog.read_view_state",
      "t3work.backlog.list_visible_items",
      "t3work.backlog.read_hierarchy",
      "t3work.backlog.read_planning_lanes",
      "t3work.backlog.read_ownership_groups",
      "t3work.backlog.read_table_state",
      "t3work.backlog.list_boards",
      "t3work.backlog.list_sprints",
      "t3work.backlog.list_saved_filters",
      "t3work.backlog.search_assignable_users",
      "t3work.backlog.jql.preview",
    ],
  }),
  ...definePlannedTools({
    kind: "view-state",
    surfaces: ["backlog"],
    ids: [
      "t3work.backlog.set_query",
      "t3work.backlog.set_assignee_filter",
      "t3work.backlog.set_saved_filter",
      "t3work.backlog.set_board",
      "t3work.backlog.set_sprint",
      "t3work.backlog.set_view_mode",
      "t3work.backlog.set_focus_filter",
      "t3work.backlog.set_table_grouping",
      "t3work.backlog.set_table_sort",
      "t3work.backlog.set_visible_columns",
      "t3work.backlog.collapse_groups",
      "t3work.backlog.expand_groups",
      "t3work.backlog.refresh",
      "t3work.backlog.open_item",
      "t3work.backlog.jql.open",
    ],
  }),
  ...definePlannedTools({
    kind: "draft-mutation",
    surfaces: ["backlog"],
    ids: [
      "t3work.backlog.item.assignee.draft_update",
      "t3work.backlog.item.estimate.draft_update",
      "t3work.backlog.item.subtask.draft_create",
      "t3work.backlog.saved_filter.draft_create",
    ],
  }),
  ...definePlannedTools({
    kind: "external-convenience",
    surfaces: ["backlog"],
    ids: ["t3work.backlog.saved_filter.create_and_open"],
  }),
  ...definePlannedTools({
    kind: "read",
    surfaces: ["my-work"],
    ids: [
      "t3work.my_work.attach_view_context",
      "t3work.my_work.refresh_view_context",
      "t3work.my_work.read_view_state",
      "t3work.my_work.list_visible_items",
      "t3work.my_work.list_metrics",
      "t3work.my_work.list_kanban_columns",
      "t3work.my_work.read_parent_child_groups",
      "t3work.my_work.list_github_activity",
      "t3work.my_work.list_unmatched_github_activity",
    ],
  }),
  ...definePlannedTools({
    kind: "view-state",
    surfaces: ["my-work"],
    ids: [
      "t3work.my_work.set_query",
      "t3work.my_work.set_view_mode",
      "t3work.my_work.set_group_mode",
      "t3work.my_work.set_status_category",
      "t3work.my_work.set_show_jira_items",
      "t3work.my_work.set_show_github_activity",
      "t3work.my_work.set_type_filter",
      "t3work.my_work.set_priority_filter",
      "t3work.my_work.set_exact_status_filter",
      "t3work.my_work.reset_advanced_filters",
      "t3work.my_work.open_item",
    ],
  }),
] as const;

export const PLANNED_PROJECT_BACKLOG_MY_WORK_T3WORK_TOOL_CATALOG = Object.fromEntries(
  PLANNED_PROJECT_BACKLOG_MY_WORK_TOOL_ENTRIES.map((tool) => [tool.id, tool]),
) as Readonly<Record<string, T3workToolCatalogEntry>>;
