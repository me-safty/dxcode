import { useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { T3SurfacePanel } from "~/t3work/components/ui/t3work-surface";
import { ProjectDashboardUnmatchedActivity } from "~/t3work/t3work-ProjectDashboardUnmatchedActivity";
import { ProjectMyWorkContent } from "~/t3work/t3work-ProjectMyWorkContent";
import { ProjectMyWorkFilterBar } from "~/t3work/t3work-ProjectMyWorkFilterBar";
import { readLinkedRepositoryUrlsFromProject } from "~/t3work/hooks/t3work-createProjectBootstrap";
import { useProjectGitHubActivity } from "~/t3work/hooks/t3work-useProjectGitHubActivity";
import { useProjectKanbanStatusMutation } from "~/t3work/hooks/t3work-useProjectKanbanStatusMutation";
import { useProjectMyWorkState } from "~/t3work/hooks/t3work-useProjectMyWorkState";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function ProjectDashboardMyWorkView({
  project,
  fallbackTickets,
  onOpenTicket,
}: {
  project: ProjectShellProject;
  fallbackTickets: ProjectTicket[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
}) {
  const linkedRepositoryUrls = useMemo(
    () => readLinkedRepositoryUrlsFromProject(project),
    [project],
  );
  const githubActivity = useProjectGitHubActivity({
    project,
    linkedRepositoryUrls,
    enabled: true,
  });
  const {
    tickets,
    reloadTickets,
    currentUserDisplayName,
    jiraLastCheckedAt,
    metrics,
    query,
    setQuery,
    viewMode,
    setViewMode,
    groupMode,
    setGroupMode,
    showGitHubActivity,
    setShowGitHubActivity,
    statusCategory,
    setStatusCategory,
    activeOptionsCount,
    excludedTypeKeys,
    hiddenKanbanColumnIds,
    epicsHidden,
    setEpicsHidden,
    toggleKanbanLaneVisibility,
    toggleTypeVisibility,
    typeOptions,
    kanbanLaneOptions,
    selectedPriority,
    setSelectedPriority,
    priorityOptions,
    selectedStatus,
    setSelectedStatus,
    statusOptions,
    tableSortBy,
    setTableSortBy,
    tableSortDirection,
    setTableSortDirection,
    resetOptionsFilters,
    assignedWorkItems,
    filteredWorkItems,
    visibleHierarchy,
    kanbanColumns,
    parentChildGroups,
  } = useProjectMyWorkState({ project, fallbackTickets });
  const { canMoveTickets, moveTicketToStatus } = useProjectKanbanStatusMutation({
    project,
    reloadTickets,
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-2 border-b border-border/70 pb-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Assigned", value: metrics.total },
          { label: "Active", value: metrics.active },
          { label: "In review", value: metrics.review },
          { label: "Done", value: metrics.done },
        ].map((metric) => (
          <T3SurfacePanel key={metric.label} tone="soft" className="px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{metric.value}</div>
          </T3SurfacePanel>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">My work items</h3>
            <p className="text-xs text-muted-foreground">
              {currentUserDisplayName
                ? `${currentUserDisplayName}'s assigned Jira work and recent GitHub updates.`
                : "Assigned Jira work and recent GitHub updates."}
            </p>
          </div>
        </div>

        <ProjectMyWorkFilterBar
          query={query}
          onQueryChange={setQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          groupMode={groupMode}
          onGroupModeChange={setGroupMode}
          statusCategory={statusCategory}
          onStatusCategoryChange={setStatusCategory}
          activeOptionsCount={activeOptionsCount}
          showGitHubActivity={showGitHubActivity}
          onShowGitHubActivityChange={setShowGitHubActivity}
          hiddenKanbanColumnIds={hiddenKanbanColumnIds}
          onKanbanLaneVisibilityChange={toggleKanbanLaneVisibility}
          epicsHidden={epicsHidden}
          onEpicsHiddenChange={setEpicsHidden}
          excludedTypeKeys={excludedTypeKeys}
          onTypeVisibilityChange={toggleTypeVisibility}
          typeOptions={typeOptions}
          kanbanLaneOptions={kanbanLaneOptions}
          selectedPriority={selectedPriority}
          onSelectedPriorityChange={setSelectedPriority}
          priorityOptions={priorityOptions}
          selectedStatus={selectedStatus}
          onSelectedStatusChange={setSelectedStatus}
          statusOptions={statusOptions}
          tableSortBy={tableSortBy}
          onTableSortByChange={setTableSortBy}
          tableSortDirection={tableSortDirection}
          onTableSortDirectionChange={setTableSortDirection}
          onReset={resetOptionsFilters}
        />

        <ProjectMyWorkContent
          project={project}
          tickets={tickets}
          assignedWorkItems={assignedWorkItems}
          filteredWorkItems={filteredWorkItems}
          visibleHierarchy={visibleHierarchy}
          viewMode={viewMode}
          groupMode={groupMode}
          showGitHubActivity={showGitHubActivity}
          tableSortBy={tableSortBy}
          tableSortDirection={tableSortDirection}
          kanbanColumns={kanbanColumns}
          parentChildGroups={parentChildGroups}
          githubActivityByWorkItem={githubActivity.activityByWorkItem}
          {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
          {...(githubActivity.lastCheckedAt !== undefined
            ? { githubLastCheckedAt: githubActivity.lastCheckedAt }
            : {})}
          onTableSortByChange={setTableSortBy}
          onTableSortDirectionChange={setTableSortDirection}
          {...(canMoveTickets ? { onMoveTicketToStatus: moveTicketToStatus } : {})}
          onOpenTicket={onOpenTicket}
        />
      </section>

      <section>
        <ProjectDashboardUnmatchedActivity project={project} githubActivity={githubActivity} />
      </section>

      {githubActivity.loading ? (
        <p className="text-[11px] text-muted-foreground">Refreshing GitHub activity...</p>
      ) : null}
    </div>
  );
}
