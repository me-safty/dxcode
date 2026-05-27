import { SidebarMenuSub } from "~/t3work/components/ui/t3work-sidebar";
import { ProjectSidebarCurrentIssuesContent } from "./t3work-ProjectSidebarCurrentIssuesContent";
import { ProjectSidebarDashboardNav } from "./t3work-ProjectSidebarDashboardNav";
import { ProjectSidebarDashboardThreadList } from "./t3work-ProjectSidebarDashboardThreadList";
import { ProjectSidebarProjectHeader } from "./t3work-ProjectSidebarProjectHeader";
import { ProjectSidebarThreadOverflowToggle } from "./t3work-ProjectSidebarThreadOverflowToggle";
import { ThreadRow } from "./t3work-ProjectSidebarThreadRow";
import type { ProjectRowProps } from "./t3work-projectSidebarProjectRowTypes";
import { useProjectSidebarProjectRow } from "./t3work-useProjectSidebarProjectRow";
import { useProjectSidebarProjectRowPinnedState } from "./t3work-useProjectSidebarProjectRowPinnedState";
import {
  getSidebarProjectSectionState,
  getSidebarProjectState,
  getSidebarThreadState,
} from "./t3work-projectSidebarItemState";

export function ProjectSidebarProjectRowView(props: ProjectRowProps) {
  const state = useProjectSidebarProjectRow(props);
  const {
    project,
    expanded,
    projectStatus,
    view,
    activeDashboardMode,
    ticketViewMode,
    showProjectThreads,
    showMyActivityFeed,
    showJiraItems,
    showGitHubActivity,
    onSelectProjectDashboardMode,
    onSelectThread,
    onSelectTicket,
    onCreateTicketThread,
    onDeleteThread,
    onRenameThread,
  } = props;
  const projectState = getSidebarProjectState({ view, projectId: project.id });
  const backlogState = getSidebarProjectSectionState({
    activeDashboardMode,
    dashboardMode: "backlog",
    projectId: project.id,
    view,
  });
  const myWorkState = getSidebarProjectSectionState({
    activeDashboardMode,
    dashboardMode: "my-work",
    projectId: project.id,
    view,
  });
  const {
    showPinnedOnlyFeed,
    effectiveProjectTickets,
    effectiveTicketHierarchy,
    effectiveVisibleFlatTickets,
    effectiveGitHubActivityByWorkItem,
    effectiveUnlinkedGitHubItems,
    effectiveVisibleTicketIds,
    effectiveHiddenTicketCount,
  } = useProjectSidebarProjectRowPinnedState(props, state);

  return (
    <>
      <ProjectSidebarProjectHeader
        project={project}
        state={projectState}
        expanded={expanded}
        projectStatus={projectStatus}
        isRenaming={state.isRenaming}
        renameInputRef={state.renameInputRef}
        renameTitle={state.renameTitle}
        setRenameTitle={state.setRenameTitle}
        onProjectClick={state.handleProjectClick}
        onContextMenu={state.handleContextMenu}
        onToggleExpand={state.handleToggleExpand}
        onRenameKeyDown={state.handleRenameKeyDown}
        onRenameSubmit={state.handleRenameSubmit}
        onNewThread={state.handleNewThread}
        onOpenMenu={state.handleOpenMenu}
      />

      {expanded ? (
        <ProjectSidebarDashboardNav
          backlogState={backlogState}
          myWorkState={myWorkState}
          myWorkExpanded={state.myWorkExpanded}
          myWorkThreadCount={showMyActivityFeed ? state.myWorkThreads.length : 0}
          pinnedItemCount={0}
          onMyWorkExpandedChange={state.setMyWorkExpanded}
          onSelectBacklog={() => onSelectProjectDashboardMode(project.id, "backlog")}
          onSelectMyWork={() => {
            state.setMyWorkExpanded(true);
            onSelectProjectDashboardMode(project.id, "my-work");
          }}
          backlogContent={
            <ProjectSidebarDashboardThreadList
              projectId={project.id}
              threads={state.backlogThreads}
              view={view}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          }
          myWorkContent={
            showMyActivityFeed ? (
              <ProjectSidebarDashboardThreadList
                projectId={project.id}
                threads={state.myWorkThreads}
                view={view}
                onSelectThread={onSelectThread}
                onDeleteThread={onDeleteThread}
                onRenameThread={onRenameThread}
              />
            ) : undefined
          }
          pinnedContent={undefined}
          showMyActivityFeed={showMyActivityFeed}
          showJiraItems={showJiraItems}
          currentIssueCount={
            showPinnedOnlyFeed ? effectiveProjectTickets.length : props.projectTickets.length
          }
          currentIssuesContent={
            <ProjectSidebarCurrentIssuesContent
              project={project}
              projectTickets={effectiveProjectTickets}
              ticketViewMode={ticketViewMode}
              view={view}
              visibleTreeRoots={effectiveTicketHierarchy.roots}
              visibleFlatTickets={effectiveVisibleFlatTickets}
              visibleTreeUnresolvedChildren={effectiveTicketHierarchy.unresolvedChildren}
              hiddenTicketCount={effectiveHiddenTicketCount}
              childrenByParentId={effectiveTicketHierarchy.childrenByParentId}
              ticketThreadsById={state.ticketThreadsById}
              githubActivityByWorkItem={effectiveGitHubActivityByWorkItem}
              {...(props.jiraLastCheckedAt !== undefined
                ? { jiraLastCheckedAt: props.jiraLastCheckedAt }
                : {})}
              {...(state.githubActivityLastCheckedAt !== undefined
                ? { githubActivityLastCheckedAt: state.githubActivityLastCheckedAt }
                : {})}
              showGitHubActivity={showGitHubActivity}
              onSelectTicket={onSelectTicket}
              onCreateTicketThread={onCreateTicketThread}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          }
          showGitHubActivity={showGitHubActivity}
          githubItems={effectiveUnlinkedGitHubItems}
          {...(state.githubActivityLastCheckedAt !== undefined
            ? { githubActivityLastCheckedAt: state.githubActivityLastCheckedAt }
            : {})}
        />
      ) : null}

      {expanded && showProjectThreads && (
        <SidebarMenuSub className="mx-1 mt-1 mb-1.5 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0.5">
          {state.visibleThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              state={getSidebarThreadState({ view, threadId: thread.id })}
              onSelect={() => onSelectThread(project.id, thread.id)}
              onDelete={() => onDeleteThread(thread.id)}
              onRename={(newTitle) => onRenameThread(thread.id, newTitle)}
            />
          ))}
          {state.hasOverflowingThreads && (
            <ProjectSidebarThreadOverflowToggle
              expanded={state.expandedThreadList}
              onToggle={() => state.setExpandedThreadList(!state.expandedThreadList)}
            />
          )}
        </SidebarMenuSub>
      )}
    </>
  );
}
