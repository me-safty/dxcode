import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  EllipsisIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { Button } from "~/t3work/components/ui/t3work-button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "~/t3work/components/ui/t3work-sidebar";
import {
  Menu,
  MenuPopup,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuGroup,
  MenuSeparator,
} from "~/t3work/components/ui/t3work-menu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/t3work/components/ui/t3work-tooltip";
import { useProjectResources } from "~/t3work/hooks/t3work-useProjectResources";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import { buildProjectTicketHierarchy } from "~/t3work/t3work-ticketHierarchy";
import type { ProjectShellProject } from "@t3tools/project-context";
import type {
  ProjectThread,
  ProjectTicket,
  ViewState,
  ProjectSortOrder,
  ThreadSortOrder,
  ThreadStatusPill,
} from "~/t3work/t3work-types";

const PROJECT_SORT_LABELS: Record<ProjectSortOrder, string> = {
  updated_at: "Last message",
  created_at: "Created at",
};

const THREAD_SORT_LABELS: Record<ThreadSortOrder, string> = {
  updated_at: "Last message",
  created_at: "Created at",
};

type TicketViewMode = "flat" | "tree";

const TICKET_VIEW_LABELS: Record<TicketViewMode, string> = {
  flat: "Flat",
  tree: "Hierarchy",
};

function resolveThreadStatusPill(thread: {
  status: ProjectThread["status"];
}): ThreadStatusPill | null {
  switch (thread.status) {
    case "running":
      return {
        label: "Working",
        colorClass: "text-sky-600 dark:text-sky-300/80",
        dotClass: "bg-sky-500 dark:bg-sky-300/80",
        pulse: true,
      };
    case "completed":
      return {
        label: "Completed",
        colorClass: "text-emerald-600 dark:text-emerald-300/90",
        dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
        pulse: false,
      };
    case "error":
      return {
        label: "Error",
        colorClass: "text-red-600 dark:text-red-300/90",
        dotClass: "bg-red-500 dark:bg-red-300/90",
        pulse: false,
      };
    default:
      return null;
  }
}

function resolveProjectStatusIndicator(threads: ProjectThread[]): ThreadStatusPill | null {
  const priority: Record<ThreadStatusPill["label"], number> = {
    Working: 3,
    Error: 2,
    Completed: 1,
    Idle: 0,
  };
  let highest: ThreadStatusPill | null = null;
  for (const thread of threads) {
    const pill = resolveThreadStatusPill(thread);
    if (!pill) continue;
    if (!highest || priority[pill.label] > priority[highest.label]) {
      highest = pill;
    }
  }
  return highest;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function sortThreads(threads: ProjectThread[], sortOrder: ThreadSortOrder): ProjectThread[] {
  return [...threads].sort((a, b) => {
    const aTime =
      sortOrder === "updated_at"
        ? new Date(a.lastMessageAt).getTime()
        : new Date(a.createdAt).getTime();
    const bTime =
      sortOrder === "updated_at"
        ? new Date(b.lastMessageAt).getTime()
        : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
}

function sortProjects(
  projects: ProjectShellProject[],
  threadsByProject: Map<string, ProjectThread[]>,
  sortOrder: ProjectSortOrder,
): ProjectShellProject[] {
  if (sortOrder === "created_at") {
    return [...projects].sort((a, b) => {
      const aTime = new Date(a.createdAt ?? 0).getTime();
      const bTime = new Date(b.createdAt ?? 0).getTime();
      return bTime - aTime;
    });
  }
  return [...projects].sort((a, b) => {
    const aThreads = threadsByProject.get(a.id) ?? [];
    const bThreads = threadsByProject.get(b.id) ?? [];
    const aLatest = aThreads.reduce(
      (latest, t) => Math.max(latest, new Date(t.lastMessageAt).getTime()),
      0,
    );
    const bLatest = bThreads.reduce(
      (latest, t) => Math.max(latest, new Date(t.lastMessageAt).getTime()),
      0,
    );
    return bLatest - aLatest;
  });
}

interface ProjectSidebarProps {
  projects: ProjectShellProject[];
  selectedId: string | null;
  expandedIds: Set<string>;
  threads: ProjectThread[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
  view: ViewState | null;
  projectSortOrder: ProjectSortOrder;
  threadSortOrder: ThreadSortOrder;
  threadPreviewCount: number;
  onSelectProject: (id: string) => void;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onToggleExpand: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newTitle: string) => void;
  onCreateThread: (projectId: string) => void;
  onCreateTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
  }) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
  onProjectSortOrderChange: (sortOrder: ProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: ThreadSortOrder) => void;
  onThreadPreviewCountChange: (count: number) => void;
}

export function ProjectSidebar({
  projects,
  selectedId,
  expandedIds,
  threads,
  getThreadsForProject,
  view,
  projectSortOrder,
  threadSortOrder,
  threadPreviewCount,
  onSelectProject,
  onSelectTicket,
  onSelectThread,
  onToggleExpand,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onCreateThread,
  onCreateTicketThread,
  onDeleteThread,
  onRenameThread,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
  onThreadPreviewCountChange,
}: ProjectSidebarProps) {
  const [ticketViewMode, setTicketViewMode] = useState<TicketViewMode>("tree");

  const threadsByProject = useMemo(() => {
    const map = new Map<string, ProjectThread[]>();
    for (const thread of threads) {
      const existing = map.get(thread.projectId) ?? [];
      existing.push(thread);
      map.set(thread.projectId, existing);
    }
    return map;
  }, [threads]);

  const sortedProjects = useMemo(
    () => sortProjects(projects, threadsByProject, projectSortOrder),
    [projects, threadsByProject, projectSortOrder],
  );

  return (
    <>
      <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <span className="truncate text-sm font-semibold">T3 Work</span>
          <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            Work shell
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 pt-2 pb-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-0"
              >
                <SearchIcon className="size-3.5" />
                <span className="flex-1 truncate text-left text-xs">Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <ProjectSortMenu
                projectSortOrder={projectSortOrder}
                threadSortOrder={threadSortOrder}
                threadPreviewCount={threadPreviewCount}
                ticketViewMode={ticketViewMode}
                onProjectSortOrderChange={onProjectSortOrderChange}
                onTicketViewModeChange={setTicketViewMode}
                onThreadSortOrderChange={onThreadSortOrderChange}
                onThreadPreviewCountChange={onThreadPreviewCountChange}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Add project"
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={onCreateProject}
                    />
                  }
                >
                  <FolderPlusIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="right">Add project</TooltipPopup>
              </Tooltip>
            </div>
          </div>

          <SidebarMenu>
            {sortedProjects.map((project) => {
              const projectThreads = getThreadsForProject(project.id);
              const expanded = expandedIds.has(project.id);
              const projectStatus = resolveProjectStatusIndicator(projectThreads);
              return (
                <SidebarMenuItem key={project.id} className="mb-2 rounded-md last:mb-0">
                  <ProjectRowWithTickets
                    project={project}
                    projectThreads={projectThreads}
                    expanded={expanded}
                    projectStatus={projectStatus}
                    view={view}
                    threadSortOrder={threadSortOrder}
                    threadPreviewCount={threadPreviewCount}
                    ticketViewMode={ticketViewMode}
                    onSelectProject={onSelectProject}
                    onToggleExpand={onToggleExpand}
                    onSelectThread={onSelectThread}
                    onSelectTicket={onSelectTicket}
                    onDeleteProject={onDeleteProject}
                    onRenameProject={onRenameProject}
                    onCreateThread={onCreateThread}
                    onCreateTicketThread={onCreateTicketThread}
                    onDeleteThread={onDeleteThread}
                    onRenameThread={onRenameThread}
                  />
                </SidebarMenuItem>
              );
            })}

            {projects.length === 0 && (
              <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                No projects yet
              </div>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            >
              <SettingsIcon className="size-3.5" />
              <span className="text-xs">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

interface ProjectRowProps {
  project: ProjectShellProject;
  projectThreads: ProjectThread[];
  projectTickets: ProjectTicket[];
  expanded: boolean;
  projectStatus: ThreadStatusPill | null;
  view: ViewState | null;
  threadSortOrder: ThreadSortOrder;
  threadPreviewCount: number;
  ticketViewMode: TicketViewMode;
  onSelectProject: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newTitle: string) => void;
  onCreateThread: (projectId: string) => void;
  onCreateTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
  }) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
}

function ProjectRowWithTickets(props: Omit<ProjectRowProps, "projectTickets">) {
  const { tickets } = useProjectResources(props.project);
  return <ProjectRow {...props} projectTickets={tickets} />;
}

const ProjectRow = memo(function ProjectRow(props: ProjectRowProps) {
  const {
    project,
    projectThreads,
    projectTickets,
    expanded,
    projectStatus,
    view,
    threadSortOrder,
    threadPreviewCount,
    ticketViewMode,
    onSelectProject,
    onToggleExpand,
    onSelectThread,
    onSelectTicket,
    onDeleteProject,
    onRenameProject,
    onCreateThread,
    onCreateTicketThread,
    onDeleteThread,
    onRenameThread,
  } = props;

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(project.title);
  const [expandedThreadList, setExpandedThreadList] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const sortedThreads = useMemo(
    () => sortThreads(projectThreads, threadSortOrder),
    [projectThreads, threadSortOrder],
  );

  const projectLevelThreads = useMemo(
    () => sortedThreads.filter((thread) => !thread.ticketId),
    [sortedThreads],
  );

  const ticketThreadsById = useMemo(() => {
    const map = new Map<string, ProjectThread[]>();
    for (const thread of sortedThreads) {
      if (!thread.ticketId) continue;
      const existing = map.get(thread.ticketId) ?? [];
      existing.push(thread);
      map.set(thread.ticketId, existing);
    }
    return map;
  }, [sortedThreads]);

  const hasOverflowingThreads = projectLevelThreads.length > threadPreviewCount;
  const visibleThreads =
    expandedThreadList || !hasOverflowingThreads
      ? projectLevelThreads
      : projectLevelThreads.slice(0, threadPreviewCount);

  const ticketHierarchy = useMemo(
    () => buildProjectTicketHierarchy(projectTickets),
    [projectTickets],
  );

  const visibleFlatTickets = useMemo(() => projectTickets.slice(0, 5), [projectTickets]);

  const visibleTreeRoots = useMemo(() => ticketHierarchy.roots.slice(0, 5), [ticketHierarchy]);

  const visibleTreeUnresolvedChildren = useMemo(() => {
    const availableSlots = Math.max(0, 5 - visibleTreeRoots.length);
    if (availableSlots === 0) {
      return [] as readonly ProjectTicket[];
    }
    return ticketHierarchy.unresolvedChildren.slice(0, availableSlots);
  }, [ticketHierarchy, visibleTreeRoots.length]);

  const countVisibleTicketTreeNodes = useCallback(
    (ticket: ProjectTicket): number => {
      const children = ticketHierarchy.childrenByParentId.get(ticket.id) ?? [];
      return 1 + children.reduce((count, child) => count + countVisibleTicketTreeNodes(child), 0);
    },
    [ticketHierarchy],
  );

  const hiddenTicketCount = useMemo(() => {
    if (ticketViewMode === "flat") {
      return Math.max(0, projectTickets.length - visibleFlatTickets.length);
    }

    const visibleTreeCount =
      visibleTreeRoots.reduce((count, ticket) => count + countVisibleTicketTreeNodes(ticket), 0) +
      visibleTreeUnresolvedChildren.length;
    return Math.max(0, projectTickets.length - visibleTreeCount);
  }, [
    countVisibleTicketTreeNodes,
    projectTickets.length,
    ticketViewMode,
    visibleFlatTickets.length,
    visibleTreeRoots,
    visibleTreeUnresolvedChildren.length,
  ]);

  const handleProjectClick = useCallback(() => {
    onSelectProject(project.id);
  }, [onSelectProject, project.id]);

  const handleNewThread = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCreateThread(project.id);
    },
    [onCreateThread, project.id],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const action = window.prompt(
        `Project: ${project.title}\n\nType "rename" to rename, "delete" to delete:`,
      );
      if (action === "rename") {
        const newTitle = window.prompt("New project title:", project.title);
        if (newTitle && newTitle.trim() && newTitle.trim() !== project.title) {
          onRenameProject(project.id, newTitle.trim());
        }
      } else if (action === "delete") {
        if (window.confirm(`Delete project "${project.title}"?`)) {
          onDeleteProject(project.id);
        }
      }
    },
    [project, onDeleteProject, onRenameProject],
  );

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameTitle.trim();
    if (trimmed && trimmed !== project.title) {
      onRenameProject(project.id, trimmed);
    } else {
      setRenameTitle(project.title);
    }
    setIsRenaming(false);
  }, [renameTitle, project, onRenameProject]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setRenameTitle(project.title);
        setIsRenaming(false);
      }
    },
    [handleRenameSubmit, project.title],
  );

  return (
    <>
      <div className="group/project-header relative mb-1">
        <SidebarMenuButton
          size="sm"
          className="gap-2 px-2 py-1.5 pr-8 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground max-sm:pr-14 cursor-pointer"
          onClick={handleProjectClick}
          onContextMenu={handleContextMenu}
        >
          {!expanded && projectStatus ? (
            <span
              aria-hidden="true"
              title={projectStatus.label}
              className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
            >
              <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                <span
                  className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                    projectStatus.pulse ? "animate-pulse" : ""
                  }`}
                />
              </span>
              <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
            </span>
          ) : (
            <ChevronRightIcon
              className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                expanded ? "rotate-90" : ""
              }`}
            />
          )}
          <ProjectIcon project={project} />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleRenameSubmit}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate text-xs font-medium text-foreground/90">
                {project.title}
              </span>
            )}
          </span>
        </SidebarMenuButton>

        <Tooltip>
          <TooltipTrigger
            render={
              <div className="pointer-events-none absolute top-1 right-1.5 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100">
                <button
                  type="button"
                  aria-label={`Create new thread in ${project.title}`}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
                  onClick={handleNewThread}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              </div>
            }
          />
          <TooltipPopup side="top">New thread</TooltipPopup>
        </Tooltip>
      </div>

      {expanded && (
        <SidebarMenuSub className="mx-1 mt-1 mb-1.5 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0.5">
          {visibleThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isActive={view?.type === "thread" && view.threadId === thread.id}
              onSelect={() => onSelectThread(project.id, thread.id)}
              onDelete={() => onDeleteThread(thread.id)}
              onRename={(newTitle) => onRenameThread(thread.id, newTitle)}
            />
          ))}
          {hasOverflowingThreads && !expandedThreadList && (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                size="sm"
                className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                onClick={() => setExpandedThreadList(true)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span>Show more</span>
                </span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
          {hasOverflowingThreads && expandedThreadList && (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                size="sm"
                className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                onClick={() => setExpandedThreadList(false)}
              >
                <span>Show less</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      )}

      {expanded &&
        (() => {
          if (projectTickets.length === 0) return null;
          return (
            <SidebarMenuSub className="mx-1 mt-1.5 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 pb-0.5">
              {ticketViewMode === "tree"
                ? visibleTreeRoots.map((ticket) => (
                    <SidebarMenuSubItem key={ticket.id} className="w-full">
                      <TicketTreeNode
                        ticket={ticket}
                        projectId={project.id}
                        view={view}
                        childrenByParentId={ticketHierarchy.childrenByParentId}
                        ticketThreadsById={ticketThreadsById}
                        onSelectTicket={onSelectTicket}
                        onCreateTicketThread={onCreateTicketThread}
                        onSelectThread={onSelectThread}
                        onDeleteThread={onDeleteThread}
                        onRenameThread={onRenameThread}
                      />
                    </SidebarMenuSubItem>
                  ))
                : visibleFlatTickets.map((ticket) => (
                    <SidebarMenuSubItem key={ticket.id} className="w-full">
                      <TicketSidebarEntry
                        ticket={ticket}
                        projectId={project.id}
                        view={view}
                        ticketThreads={ticketThreadsById.get(ticket.id) ?? []}
                        onSelectTicket={onSelectTicket}
                        onCreateTicketThread={onCreateTicketThread}
                        onSelectThread={onSelectThread}
                        onDeleteThread={onDeleteThread}
                        onRenameThread={onRenameThread}
                      />
                    </SidebarMenuSubItem>
                  ))}

              {ticketViewMode === "tree" && visibleTreeUnresolvedChildren.length > 0 ? (
                <div className="mt-1 space-y-1">
                  <div className="px-2 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
                    Unlinked
                  </div>
                  {visibleTreeUnresolvedChildren.map((ticket) => (
                    <SidebarMenuSubItem key={ticket.id} className="w-full">
                      <TicketSidebarEntry
                        ticket={ticket}
                        projectId={project.id}
                        view={view}
                        ticketThreads={ticketThreadsById.get(ticket.id) ?? []}
                        onSelectTicket={onSelectTicket}
                        onCreateTicketThread={onCreateTicketThread}
                        onSelectThread={onSelectThread}
                        onDeleteThread={onDeleteThread}
                        onRenameThread={onRenameThread}
                      />
                    </SidebarMenuSubItem>
                  ))}
                </div>
              ) : null}

              {hiddenTicketCount > 0 && (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton size="sm">
                    <span className="text-[10px] text-muted-foreground/60">
                      +{hiddenTicketCount} more
                    </span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )}
            </SidebarMenuSub>
          );
        })()}
    </>
  );
});

interface ThreadRowProps {
  thread: ProjectThread;
  variant?: "default" | "issue";
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

const ThreadRow = memo(function ThreadRow(props: ThreadRowProps) {
  const { thread, variant = "default", isActive, onSelect, onDelete, onRename } = props;
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(thread.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const statusPill = resolveThreadStatusPill(thread);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const action = window.prompt(
        `Thread: ${thread.title}\n\nType "rename" to rename, "delete" to delete, "copy" to copy ID:`,
      );
      if (action === "rename") {
        const newTitle = window.prompt("New thread title:", thread.title);
        if (newTitle && newTitle.trim() && newTitle.trim() !== thread.title) {
          onRename(newTitle.trim());
        }
      } else if (action === "delete") {
        if (window.confirm(`Delete thread "${thread.title}"?`)) {
          onDelete();
        }
      } else if (action === "copy") {
        void navigator.clipboard.writeText(thread.id);
      }
    },
    [thread, onDelete, onRename],
  );

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameTitle.trim();
    if (trimmed && trimmed !== thread.title) {
      onRename(trimmed);
    } else {
      setRenameTitle(thread.title);
    }
    setIsRenaming(false);
  }, [renameTitle, thread.title, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setRenameTitle(thread.title);
        setIsRenaming(false);
      }
    },
    [handleRenameSubmit, thread.title],
  );

  return (
    <SidebarMenuSubItem className="w-full" onContextMenu={handleContextMenu}>
      <SidebarMenuSubButton
        size="sm"
        isActive={isActive}
        className={`h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none ${
          variant === "issue" ? "rounded-md bg-muted/25 hover:bg-accent/70" : ""
        }`}
        onClick={onSelect}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {variant === "issue" ? (
            <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground/70" />
          ) : null}
          {statusPill && (
            <span
              className={`inline-flex size-1.5 shrink-0 rounded-full ${statusPill.dotClass} ${
                statusPill.pulse ? "animate-pulse" : ""
              }`}
              title={statusPill.label}
            />
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameSubmit}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/40">
            {formatRelativeTime(thread.lastMessageAt)}
          </span>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

function ProjectIcon({ project }: { project: ProjectShellProject }) {
  const color =
    (project.source.raw as { avatarColor?: string } | undefined)?.avatarColor ?? "#1868db";
  const key = project.source.externalProjectKey ?? project.title;
  const shortKey = key.slice(0, 2).toUpperCase();
  return (
    <div
      className="flex size-6 shrink-0 items-center justify-center rounded-md"
      style={{ background: color }}
    >
      <span className="text-[10px] font-semibold text-white">{shortKey}</span>
    </div>
  );
}

interface TicketSidebarEntryProps {
  ticket: ProjectTicket;
  projectId: string;
  view: ViewState | null;
  ticketThreads: readonly ProjectThread[];
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onCreateTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
  }) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
}

function TicketSidebarEntry({
  ticket,
  projectId,
  view,
  ticketThreads,
  onSelectTicket,
  onCreateTicketThread,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
}: TicketSidebarEntryProps) {
  return (
    <div className="group/ticket rounded-md border border-border/60 bg-background/45 p-1">
      <div className="flex items-start gap-1">
        <SidebarMenuSubButton
          size="sm"
          isActive={view?.type === "ticket" && view.ticketId === ticket.id}
          className="h-auto min-h-9 flex-1 flex-col items-start py-1.5"
          onClick={() => onSelectTicket(projectId, ticket.id)}
        >
          <div className="flex w-full items-center gap-1">
            <JiraIssueTypeIcon
              issueType={ticket.issueType}
              issueTypeIconUrl={ticket.issueTypeIconUrl ?? ticket.ref.issueTypeIconUrl}
            />
            <span className="truncate text-[11px] font-medium">{ticket.ref.displayId}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/75">{ticket.status}</span>
          </div>
          <div className="mt-0.5 w-full truncate text-[10px] text-muted-foreground/70">
            {ticket.ref.title}
          </div>
        </SidebarMenuSubButton>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Create new thread for ${ticket.ref.displayId}`}
                className="mt-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-colors transition-opacity duration-150 pointer-events-none group-hover/ticket:pointer-events-auto group-hover/ticket:opacity-100 hover:bg-accent hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateTicketThread({
                    projectId,
                    ticketId: ticket.id,
                    ticketDisplayId: ticket.ref.displayId,
                  });
                }}
              />
            }
          >
            <SquarePenIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="right">New thread for this issue</TooltipPopup>
        </Tooltip>
      </div>

      {ticketThreads.length > 0 ? (
        <div className="mt-1.5 ml-2 space-y-1 border-l border-border/70 pl-2">
          {ticketThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              variant="issue"
              isActive={view?.type === "thread" && view.threadId === thread.id}
              onSelect={() => onSelectThread(projectId, thread.id)}
              onDelete={() => onDeleteThread(thread.id)}
              onRename={(newTitle) => onRenameThread(thread.id, newTitle)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface TicketTreeNodeProps extends Omit<TicketSidebarEntryProps, "ticketThreads"> {
  ticket: ProjectTicket;
  childrenByParentId: ReadonlyMap<string, readonly ProjectTicket[]>;
  ticketThreadsById: ReadonlyMap<string, readonly ProjectThread[]>;
  depth?: number;
}

function TicketTreeNode({
  ticket,
  projectId,
  view,
  childrenByParentId,
  ticketThreadsById,
  onSelectTicket,
  onCreateTicketThread,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
  depth = 0,
}: TicketTreeNodeProps) {
  const children = childrenByParentId.get(ticket.id) ?? [];

  return (
    <div className={depth > 0 ? "ml-2 border-l border-border/60 pl-2" : ""}>
      <TicketSidebarEntry
        ticket={ticket}
        projectId={projectId}
        view={view}
        ticketThreads={ticketThreadsById.get(ticket.id) ?? []}
        onSelectTicket={onSelectTicket}
        onCreateTicketThread={onCreateTicketThread}
        onSelectThread={onSelectThread}
        onDeleteThread={onDeleteThread}
        onRenameThread={onRenameThread}
      />

      {children.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {children.map((child) => (
            <TicketTreeNode
              key={child.id}
              ticket={child}
              projectId={projectId}
              view={view}
              childrenByParentId={childrenByParentId}
              ticketThreadsById={ticketThreadsById}
              onSelectTicket={onSelectTicket}
              onCreateTicketThread={onCreateTicketThread}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  threadPreviewCount,
  ticketViewMode,
  onProjectSortOrderChange,
  onTicketViewModeChange,
  onThreadSortOrderChange,
  onThreadPreviewCountChange,
}: {
  projectSortOrder: ProjectSortOrder;
  threadSortOrder: ThreadSortOrder;
  threadPreviewCount: number;
  ticketViewMode: TicketViewMode;
  onProjectSortOrderChange: (sortOrder: ProjectSortOrder) => void;
  onTicketViewModeChange: (viewMode: TicketViewMode) => void;
  onThreadSortOrderChange: (sortOrder: ThreadSortOrder) => void;
  onThreadPreviewCountChange: (count: number) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sidebar options</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Sort projects</div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as ProjectSortOrder);
            }}
          >
            {(Object.entries(PROJECT_SORT_LABELS) as Array<[ProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">Issue view</div>
          <MenuRadioGroup
            value={ticketViewMode}
            onValueChange={(value) => {
              onTicketViewModeChange(value as TicketViewMode);
            }}
          >
            {(Object.entries(TICKET_VIEW_LABELS) as Array<[TicketViewMode, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as ThreadSortOrder);
            }}
          >
            {(Object.entries(THREAD_SORT_LABELS) as Array<[ThreadSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            Visible threads
          </div>
          <div className="px-2 py-1 flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => onThreadPreviewCountChange(Math.max(1, threadPreviewCount - 1))}
            >
              -
            </Button>
            <span className="text-xs tabular-nums">{threadPreviewCount}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => onThreadPreviewCountChange(Math.min(20, threadPreviewCount + 1))}
            >
              +
            </Button>
          </div>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
