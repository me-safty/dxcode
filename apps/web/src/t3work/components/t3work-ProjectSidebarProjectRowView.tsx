import { SidebarMenuSub } from "~/t3work/components/ui/t3work-sidebar";
import { ProjectSidebarCurrentIssuesContent } from "./t3work-ProjectSidebarCurrentIssuesContent";
import { ProjectSidebarDashboardNav } from "./t3work-ProjectSidebarDashboardNav";
import { ProjectSidebarDashboardThreadList } from "./t3work-ProjectSidebarDashboardThreadList";
import { ProjectSidebarPinnedItems } from "./t3work-ProjectSidebarPinnedItems";
import { ProjectSidebarProjectHeader } from "./t3work-ProjectSidebarProjectHeader";
import { ProjectSidebarThreadOverflowToggle } from "./t3work-ProjectSidebarThreadOverflowToggle";
import { ThreadRow } from "./t3work-ProjectSidebarThreadRow";
import type { ProjectRowProps } from "./t3work-projectSidebarProjectRowTypes";
import { useProjectSidebarPinnedItems } from "./t3work-useProjectSidebarPinnedItems";
import { useProjectSidebarProjectRow } from "./t3work-useProjectSidebarProjectRow";
import { readActiveThreadIdFromView } from "~/t3work/t3work-types";

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
    showJiraItems,
    showGitHubActivity,
    onSelectProjectDashboardMode,
    onSelectThread,
    onSelectTicket,
    onCreateTicketThread,
    onDeleteThread,
    onRenameThread,
  } = props;
  const isProjectViewActive = view?.projectId === project.id;
  const activeThreadId = readActiveThreadIdFromView(view);
  const isBacklogActive =
    isProjectViewActive && view?.type === "dashboard" && activeDashboardMode === "backlog";
  const isMyWorkActive =
    isProjectViewActive &&
    (view?.type === "ticket" ||
      view?.type === "thread" ||
      (view?.type === "dashboard" && (activeDashboardMode ?? "my-work") === "my-work"));
  const pinnedItems = useProjectSidebarPinnedItems({
    project,
    projectTickets: props.projectTickets,
    githubActivityByWorkItem: state.githubActivityByWorkItem,
    unlinkedGitHubActivityItems: state.unlinkedGitHubActivityItems,
  });

  return (
    <>
      <ProjectSidebarProjectHeader
        project={project}
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
          isBacklogActive={isBacklogActive}
          isMyWorkActive={isMyWorkActive}
          myWorkExpanded={state.myWorkExpanded}
          myWorkThreadCount={state.myWorkThreads.length}
          pinnedItemCount={pinnedItems.length}
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
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          }
          myWorkContent={
            <ProjectSidebarDashboardThreadList
              projectId={project.id}
              threads={state.myWorkThreads}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          }
          pinnedContent={
            <ProjectSidebarPinnedItems
              project={project}
              projectTickets={props.projectTickets}
              githubActivityByWorkItem={state.githubActivityByWorkItem}
              items={pinnedItems}
              {...(props.jiraLastCheckedAt !== undefined
                ? { jiraLastCheckedAt: props.jiraLastCheckedAt }
                : {})}
              {...(state.githubActivityLastCheckedAt !== undefined
                ? { githubActivityLastCheckedAt: state.githubActivityLastCheckedAt }
                : {})}
              onSelectTicket={onSelectTicket}
            />
          }
          showJiraItems={showJiraItems}
          currentIssueCount={props.projectTickets.length}
          currentIssuesContent={
            <ProjectSidebarCurrentIssuesContent
              project={project}
              projectTickets={props.projectTickets}
              ticketViewMode={ticketViewMode}
              view={view}
              visibleTreeRoots={state.visibleTreeRoots}
              visibleFlatTickets={state.visibleFlatTickets}
              visibleTreeUnresolvedChildren={state.visibleTreeUnresolvedChildren}
              hiddenTicketCount={state.hiddenTicketCount}
              childrenByParentId={state.ticketHierarchy.childrenByParentId}
              ticketThreadsById={state.ticketThreadsById}
              githubActivityByWorkItem={state.githubActivityByWorkItem}
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
          githubItems={state.unlinkedGitHubActivityItems}
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
              isActive={activeThreadId === thread.id}
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
