import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  EllipsisIcon,
  ExternalLink,
  FolderKanban,
  Loader2,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { ProjectShellProject } from "@t3tools/project-context";
import { Badge } from "~/t3work/components/ui/t3work-badge";
import { Button } from "~/t3work/components/ui/t3work-button";
import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { Input } from "~/t3work/components/ui/t3work-input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/t3work/components/ui/t3work-popover";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import { Textarea } from "~/t3work/components/ui/t3work-textarea";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/t3work/components/ui/t3work-sidebar";
import { AtlassianIcon } from "~/t3work/components/brand/t3work-AtlassianLogos";
import { ProjectSidebar } from "~/t3work/components/t3work-ProjectSidebar";
import { useBackendState } from "~/t3work/backend/t3work-index";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import { useAtlassianOAuth } from "~/t3work/hooks/t3work-useAtlassianOAuth";
import { useCreateProject } from "~/t3work/hooks/t3work-useCreateProject";
import { useProjectResources } from "~/t3work/hooks/t3work-useProjectResources";
import { useProjectStore } from "~/t3work/hooks/t3work-useProjectStore";
import { useTicketDetail } from "~/t3work/hooks/t3work-useTicketDetail";
import { buildProjectTicketHierarchy } from "~/t3work/t3work-ticketHierarchy";
import { TicketMetadata } from "~/t3work/components/ticket/t3work-TicketMetadata";
import { TicketRichContent } from "~/t3work/components/ticket/t3work-TicketRichContent";
import {
  JiraIssueTypeIcon,
  readIssueTypeFromSnapshotFields,
} from "~/t3work/components/ticket/t3work-JiraIssueType";
import type { ProjectThread, ProjectTicket, ViewState } from "~/t3work/t3work-types";
import { DEFAULT_MODEL, DEFAULT_RUNTIME_MODE, ProviderInstanceId } from "@t3tools/contracts";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

type AppProps = {
  view?: ViewState | null;
  showCreate?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onOpenHome?: () => void;
  onOpenDashboard?: (projectId: string) => void;
  onOpenTicket?: (projectId: string, ticketId: string) => void;
  onOpenThread?: (projectId: string, threadId: string) => void;
  onProjectCreated?: (project: ProjectShellProject) => void;
};

const DEFAULT_KICKOFF_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
};

export function App({
  view,
  showCreate: showCreateProp,
  onCreateOpenChange,
  onOpenHome,
  onOpenDashboard,
  onOpenTicket,
  onOpenThread,
  onProjectCreated,
}: AppProps = {}) {
  const store = useProjectStore();
  const [showCreateInternal, setShowCreateInternal] = useState(false);

  const showCreate = showCreateProp ?? showCreateInternal;
  const setShowCreate = onCreateOpenChange ?? setShowCreateInternal;
  const activeView = view ?? store.view;
  const selectedProjectId = activeView?.projectId ?? store.selectedProjectId;

  const handleSelectProject = useCallback(
    (projectId: string) => {
      store.selectProject(projectId);
      onOpenDashboard?.(projectId);
    },
    [store, onOpenDashboard],
  );

  const handleSelectTicket = useCallback(
    (projectId: string, ticketId: string) => {
      store.selectTicket(projectId, ticketId);
      onOpenTicket?.(projectId, ticketId);
    },
    [store, onOpenTicket],
  );

  const handleSelectThread = useCallback(
    (projectId: string, threadId: string) => {
      store.selectThread(projectId, threadId);
      onOpenThread?.(projectId, threadId);
    },
    [store, onOpenThread],
  );

  const handleCreateThread = useCallback(
    (projectId: string) => {
      const thread = store.createThread(projectId);
      onOpenThread?.(projectId, thread.id);
    },
    [store, onOpenThread],
  );

  const handleCreateTicketKickoffThread = useCallback(
    (input: {
      projectId: string;
      ticketId: string;
      ticketDisplayId: string;
      kickoffMessage: string;
      kickoffModelSelection: ModelSelection;
      kickoffRuntimeMode: RuntimeMode;
      kickoffInteractionMode: ProviderInteractionMode;
    }) => {
      const thread = store.createThreadForTicket(input);
      onOpenThread?.(input.projectId, thread.id);
    },
    [onOpenThread, store],
  );

  const handleCreateTicketThreadFromSidebar = useCallback(
    (input: { projectId: string; ticketId: string; ticketDisplayId: string }) => {
      const matching = store
        .getThreadsForProject(input.projectId)
        .filter((thread) => thread.ticketId === input.ticketId);
      const sequence = matching.length + 1;
      const thread = store.createThread(input.projectId, {
        ticketId: input.ticketId,
        title: `${input.ticketDisplayId} thread ${sequence}`,
      });
      onOpenThread?.(input.projectId, thread.id);
    },
    [onOpenThread, store],
  );

  const handleThreadKickoffConsumed = useCallback(
    (threadId: string) => {
      store.markThreadKickoffConsumed(threadId);
    },
    [store],
  );

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      const deletedWasActive = activeView?.projectId === projectId;
      store.deleteProject(projectId);
      if (deletedWasActive) {
        onOpenHome?.();
      }
    },
    [activeView, onOpenHome, store],
  );

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      const thread = store.threads.find((candidate) => candidate.id === threadId);
      const deletedWasActive = activeView?.type === "thread" && activeView.threadId === threadId;
      store.deleteThread(threadId);
      if (deletedWasActive && thread) {
        onOpenDashboard?.(thread.projectId);
      }
    },
    [activeView, onOpenDashboard, store],
  );

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="none"
        className="border-r border-border bg-card text-foreground"
      >
        <ProjectSidebar
          projects={store.projects}
          selectedId={selectedProjectId}
          expandedIds={store.expandedProjectIds}
          threads={store.threads}
          getThreadsForProject={store.getThreadsForProject}
          view={activeView}
          projectSortOrder={store.projectSortOrder}
          threadSortOrder={store.threadSortOrder}
          threadPreviewCount={store.threadPreviewCount}
          onSelectProject={handleSelectProject}
          onSelectTicket={handleSelectTicket}
          onSelectThread={handleSelectThread}
          onToggleExpand={store.toggleProjectExpanded}
          onCreateProject={() => setShowCreate(true)}
          onDeleteProject={handleDeleteProject}
          onRenameProject={store.renameProject}
          onCreateThread={handleCreateThread}
          onCreateTicketThread={handleCreateTicketThreadFromSidebar}
          onDeleteThread={handleDeleteThread}
          onRenameThread={store.renameThread}
          onProjectSortOrderChange={store.setProjectSortOrder}
          onThreadSortOrderChange={store.setThreadSortOrder}
          onThreadPreviewCountChange={store.setThreadPreviewCount}
        />
      </Sidebar>

      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <MainContent
          view={activeView}
          projects={store.projects}
          getThreadsForProject={store.getThreadsForProject}
          onOpenTicket={handleSelectTicket}
          onOpenThread={handleSelectThread}
          onKickoffTicketThread={handleCreateTicketKickoffThread}
          onThreadKickoffConsumed={handleThreadKickoffConsumed}
          onBackToDashboard={handleSelectProject}
          onCreate={() => setShowCreate(true)}
        />
      </SidebarInset>

      {showCreate && (
        <CreateProjectDialog
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            store.addProject(project);
            onProjectCreated?.(project);
            if (!onProjectCreated) {
              setShowCreate(false);
            }
          }}
        />
      )}
    </SidebarProvider>
  );
}

function ConnectionStatusBadge() {
  const backendState = useBackendState();

  if (backendState.connectionStatus === "connected") {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Wifi className="size-3 text-emerald-500" />
        <span className="hidden sm:inline">Connected</span>
      </Badge>
    );
  }

  if (backendState.connectionStatus === "connecting") {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Loader2 className="size-3 animate-spin text-amber-500" />
        <span className="hidden sm:inline">Connecting</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <WifiOff className="size-3 text-muted-foreground" />
      <span className="hidden sm:inline">Disconnected</span>
    </Badge>
  );
}

function ProviderBadges() {
  const backendState = useBackendState();
  const readyProviders = backendState.providers.filter((p) => p.status === "ready" && p.enabled);

  if (readyProviders.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {readyProviders.slice(0, 2).map((provider) => (
        <Badge
          key={provider.instanceId}
          variant="secondary"
          className="hidden text-[10px] sm:inline-flex"
        >
          {provider.displayName ?? provider.instanceId}
        </Badge>
      ))}
      {readyProviders.length > 2 && (
        <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">
          +{readyProviders.length - 2}
        </Badge>
      )}
    </div>
  );
}

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

function MainContent({
  view,
  projects,
  getThreadsForProject,
  onOpenTicket,
  onOpenThread,
  onKickoffTicketThread,
  onThreadKickoffConsumed,
  onBackToDashboard,
  onCreate,
}: {
  view: ViewState | null;
  projects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onOpenThread: (projectId: string, threadId: string) => void;
  onKickoffTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
    kickoffMessage: string;
    kickoffModelSelection: ModelSelection;
    kickoffRuntimeMode: RuntimeMode;
    kickoffInteractionMode: ProviderInteractionMode;
  }) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onBackToDashboard: (projectId: string) => void;
  onCreate: () => void;
}) {
  if (!view) {
    return <ProjectBrowserEmpty onCreate={onCreate} />;
  }

  if (view.type === "thread") {
    const project = projects.find((candidate) => candidate.id === view.projectId) ?? null;
    const thread = project
      ? (getThreadsForProject(project.id).find((candidate) => candidate.id === view.threadId) ??
        null)
      : null;

    return (
      <ThreadChatView
        threadId={view.threadId}
        projectId={view.projectId}
        projectTitle={project?.title ?? view.projectId}
        {...(project?.workspace?.rootPath
          ? { projectWorkspaceRoot: project.workspace.rootPath }
          : {})}
        title={thread?.title ?? "New thread"}
        {...(thread?.kickoffPending && thread.kickoffMessage
          ? { initialUserMessage: thread.kickoffMessage }
          : {})}
        {...(thread?.kickoffModelSelection
          ? { initialModelSelection: thread.kickoffModelSelection }
          : {})}
        {...(thread?.kickoffRuntimeMode ? { initialRuntimeMode: thread.kickoffRuntimeMode } : {})}
        {...(thread?.kickoffInteractionMode
          ? { initialInteractionMode: thread.kickoffInteractionMode }
          : {})}
        onInitialUserMessageSent={() => {
          if (thread) {
            onThreadKickoffConsumed(thread.id);
          }
        }}
        onBack={() => onBackToDashboard(view.projectId)}
      />
    );
  }

  const project = projects.find((candidate) => candidate.id === view.projectId);
  if (!project) {
    return <ProjectBrowserEmpty onCreate={onCreate} />;
  }

  if (view.type === "dashboard") {
    return <ProjectDashboard project={project} tickets={[]} onOpenTicket={onOpenTicket} />;
  }

  if (view.type === "ticket") {
    return (
      <TicketDetailView
        project={project}
        ticketId={view.ticketId}
        projectThreads={getThreadsForProject(project.id)}
        onOpenThread={onOpenThread}
        onKickoffThread={onKickoffTicketThread}
        onBack={() => onBackToDashboard(project.id)}
      />
    );
  }

  return <ProjectBrowserEmpty onCreate={onCreate} />;
}

function ProjectBrowserEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <span className="text-sm font-medium text-muted-foreground/70">No active project</span>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionStatusBadge />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl rounded-lg border border-border/70 bg-card/30 p-8 shadow-sm/5">
          <div className="mb-5 flex size-12 items-center justify-center rounded-lg border bg-background">
            <AtlassianIcon className="size-7" />
          </div>
          <h2 className="text-xl font-semibold">Start from a Jira project</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose a Jira project to browse work items and run an agent with ticket context.
          </p>
          <Button className="mt-6 w-fit" onClick={onCreate}>
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectDashboard({
  project,
  tickets: fallbackTickets,
  onOpenTicket,
}: {
  project: ProjectShellProject;
  tickets: ProjectTicket[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
}) {
  const { tickets: fetchedTickets } = useProjectResources(project);
  const tickets = fetchedTickets.length > 0 ? fetchedTickets : fallbackTickets;

  const openTickets = tickets.filter(
    (ticket) =>
      ticket.status === "Open" ||
      ticket.status === "In Progress" ||
      ticket.status === "To Do" ||
      ticket.status === "In Development",
  );
  const inReviewTickets = tickets.filter(
    (ticket) =>
      ticket.status === "In Review" || ticket.status === "In QA" || ticket.status === "Review",
  );
  const doneTickets = tickets.filter(
    (ticket) =>
      ticket.status === "Done" || ticket.status === "Closed" || ticket.status === "Resolved",
  );

  const workItems = useMemo(() => {
    const statusRank = (status: string): number => {
      if (status === "In Progress" || status === "In Development") return 0;
      if (status === "In Review" || status === "In QA" || status === "Review") return 1;
      if (status === "Open" || status === "To Do") return 2;
      if (status === "Done" || status === "Resolved" || status === "Closed") return 3;
      return 4;
    };

    return tickets.toSorted((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      return a.ref.displayId.localeCompare(b.ref.displayId, undefined, { numeric: true });
    });
  }, [tickets]);

  const [query, setQuery] = useState("");
  const [statusCategory, setStatusCategory] = useState<"all" | "active" | "review" | "done">("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedPriority, setSelectedPriority] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "kanban">("grid");
  const [groupMode, setGroupMode] = useState<"flat" | "parent-child">("parent-child");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const typeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const ticket of tickets) {
      const value = ticket.issueType ?? ticket.ref.type;
      if (value && value.trim().length > 0) values.add(value);
    }
    return [...values].toSorted((a, b) => a.localeCompare(b));
  }, [tickets]);

  const statusOptions = useMemo(() => {
    const values = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.status.trim().length > 0) values.add(ticket.status);
    }
    return [...values].toSorted((a, b) => a.localeCompare(b));
  }, [tickets]);

  const priorityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.priority && ticket.priority.trim().length > 0) values.add(ticket.priority);
    }
    return [...values].toSorted((a, b) => a.localeCompare(b));
  }, [tickets]);

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return workItems.filter((ticket) => {
      if (statusCategory !== "all") {
        const normalizedStatus = ticket.status.toLowerCase();
        const matchesCategory =
          statusCategory === "active"
            ? normalizedStatus === "open" ||
              normalizedStatus === "to do" ||
              normalizedStatus === "in progress" ||
              normalizedStatus === "in development"
            : statusCategory === "review"
              ? normalizedStatus === "in review" ||
                normalizedStatus === "review" ||
                normalizedStatus === "in qa"
              : normalizedStatus === "done" ||
                normalizedStatus === "closed" ||
                normalizedStatus === "resolved";

        if (!matchesCategory) return false;
      }

      if (selectedType !== "all") {
        const issueType = ticket.issueType ?? ticket.ref.type ?? "";
        if (issueType !== selectedType) return false;
      }

      if (selectedStatus !== "all" && ticket.status !== selectedStatus) {
        return false;
      }

      if (selectedPriority !== "all" && ticket.priority !== selectedPriority) {
        return false;
      }

      if (!normalizedQuery) return true;

      const haystack = [
        ticket.ref.displayId,
        ticket.ref.title,
        ticket.status,
        ticket.priority ?? "",
        ticket.assignee ?? "",
        ticket.issueType ?? ticket.ref.type ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [query, selectedPriority, selectedStatus, selectedType, statusCategory, workItems]);

  const kanbanColumns = useMemo(() => {
    const columns = {
      todo: { title: "To do", items: [] as ProjectTicket[] },
      inProgress: { title: "In progress", items: [] as ProjectTicket[] },
      review: { title: "In review", items: [] as ProjectTicket[] },
      done: { title: "Done", items: [] as ProjectTicket[] },
      other: { title: "Other", items: [] as ProjectTicket[] },
    };

    const normalizeStatus = (status: string): keyof typeof columns => {
      const s = status.toLowerCase();
      if (s === "to do" || s === "open" || s === "backlog") return "todo";
      if (s === "in progress" || s === "in development") return "inProgress";
      if (s === "in review" || s === "review" || s === "in qa") return "review";
      if (s === "done" || s === "closed" || s === "resolved") return "done";
      return "other";
    };

    for (const ticket of filteredWorkItems) {
      columns[normalizeStatus(ticket.status)].items.push(ticket);
    }

    return columns;
  }, [filteredWorkItems]);

  const parentChildGroups = useMemo(
    () => buildProjectTicketHierarchy(filteredWorkItems),
    [filteredWorkItems],
  );
  const isHierarchyMode = groupMode === "parent-child";
  const activeAdvancedFilterCount =
    Number(selectedType !== "all") +
    Number(selectedPriority !== "all") +
    Number(selectedStatus !== "all");
  const linkedChildCount = useMemo(
    () =>
      parentChildGroups.roots.reduce(
        (count, parent) =>
          count + (parentChildGroups.childrenByParentId.get(parent.id)?.length ?? 0),
        0,
      ),
    [parentChildGroups],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <ProjectIcon project={project} />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <h2 className="min-w-0 truncate text-sm font-medium" title={project.title}>
            {project.title}
          </h2>
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {project.source.externalProjectKey}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProviderBadges />
          <Badge variant="secondary">{tickets.length} assigned</Badge>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/70 pb-4 text-sm">
            <div>
              <span className="text-lg font-semibold tabular-nums">{tickets.length}</span>
              <span className="ml-2 text-muted-foreground">work items</span>
            </div>
            <div>
              <span className="text-lg font-semibold tabular-nums">{openTickets.length}</span>
              <span className="ml-2 text-muted-foreground">active</span>
            </div>
            <div>
              <span className="text-lg font-semibold tabular-nums">{inReviewTickets.length}</span>
              <span className="ml-2 text-muted-foreground">in review</span>
            </div>
            <div>
              <span className="text-lg font-semibold tabular-nums">{doneTickets.length}</span>
              <span className="ml-2 text-muted-foreground">done</span>
            </div>
          </div>

          <section className="mt-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">My work items</h3>
                <p className="text-xs text-muted-foreground">
                  Prioritized by active status so current work stays front and center.
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {filteredWorkItems.length} shown
              </Badge>
            </div>

            <div className="mb-4 space-y-3 border-b border-border/70 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by key, title, assignee..."
                  className="min-w-[18rem] flex-1 border-border/70 bg-transparent"
                />

                <ToggleGroup
                  value={viewMode}
                  onChange={(value) => setViewMode(value as typeof viewMode)}
                  options={[
                    { value: "grid", label: "Grid" },
                    { value: "list", label: "List" },
                    { value: "kanban", label: "Kanban" },
                  ]}
                />

                <ToggleGroup
                  value={groupMode}
                  onChange={(value) => setGroupMode(value as typeof groupMode)}
                  options={[
                    { value: "parent-child", label: "Hierarchy" },
                    { value: "flat", label: "Flat" },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  value={statusCategory}
                  onChange={(value) => setStatusCategory(value as typeof statusCategory)}
                  options={[
                    { value: "all", label: "All" },
                    { value: "active", label: "Active" },
                    { value: "review", label: "Review" },
                    { value: "done", label: "Done" },
                  ]}
                />

                <div className="ml-auto">
                  <Popover open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={`relative text-muted-foreground hover:text-foreground ${
                            advancedFiltersOpen ? "bg-accent text-foreground" : ""
                          }`}
                        />
                      }
                    >
                      <EllipsisIcon className="size-4" />
                      <span className="sr-only">Advanced filters</span>
                      {activeAdvancedFilterCount > 0 ? (
                        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground/75" />
                      ) : null}
                    </PopoverTrigger>

                    <PopoverPopup
                      align="end"
                      side="bottom"
                      sideOffset={6}
                      className="w-[min(92vw,36rem)] p-0"
                    >
                      <div className="space-y-3 p-3">
                        <div className="flex items-center justify-between border-b border-border/70 pb-2">
                          <div className="text-xs font-medium">Advanced filters</div>
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setSelectedType("all");
                              setSelectedPriority("all");
                              setSelectedStatus("all");
                            }}
                          >
                            Reset
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <div className="space-y-1">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Type
                            </div>
                            <ToggleGroup
                              value={selectedType}
                              onChange={setSelectedType}
                              options={[
                                { value: "all", label: "All" },
                                ...typeOptions.map((type) => ({ value: type, label: type })),
                              ]}
                              wrap
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Priority
                            </div>
                            <ToggleGroup
                              value={selectedPriority}
                              onChange={setSelectedPriority}
                              options={[
                                { value: "all", label: "All" },
                                ...priorityOptions.map((priority) => ({
                                  value: priority,
                                  label: priority,
                                })),
                              ]}
                              wrap
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Exact status
                            </div>
                            <ToggleGroup
                              value={selectedStatus}
                              onChange={setSelectedStatus}
                              options={[
                                { value: "all", label: "All" },
                                ...statusOptions.map((status) => ({
                                  value: status,
                                  label: status,
                                })),
                              ]}
                              wrap
                            />
                          </div>
                        </div>
                      </div>
                    </PopoverPopup>
                  </Popover>
                </div>
              </div>
            </div>

            {isHierarchyMode && filteredWorkItems.length > 0 && (
              <div className="mb-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                Hierarchy view: {parentChildGroups.roots.length} parent
                {parentChildGroups.roots.length === 1 ? "" : "s"}, {linkedChildCount} linked child
                {linkedChildCount === 1 ? "" : "ren"}
                {parentChildGroups.unresolvedChildren.length > 0
                  ? `, ${parentChildGroups.unresolvedChildren.length} unlinked`
                  : ""}
              </div>
            )}

            {filteredWorkItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-4 py-8 text-sm text-muted-foreground">
                No tickets match your current search and filters.
              </div>
            ) : viewMode === "kanban" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {(
                  [
                    ["todo", kanbanColumns.todo],
                    ["inProgress", kanbanColumns.inProgress],
                    ["review", kanbanColumns.review],
                    ["done", kanbanColumns.done],
                    ["other", kanbanColumns.other],
                  ] as const
                ).map(([key, column]) => (
                  <section key={key} className="min-w-0">
                    <div className="mb-2 flex items-center justify-between border-b border-border/70 pb-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {column.title}
                      </h4>
                      <span className="text-[11px] text-muted-foreground">
                        {column.items.length}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {isHierarchyMode
                        ? [
                            ...parentChildGroups.roots.filter((parent) =>
                              column.items.some((item) => item.id === parent.id),
                            ),
                            ...(key === "other" ? parentChildGroups.unresolvedChildren : []),
                          ].map((parent) => {
                            const children =
                              parentChildGroups.childrenByParentId.get(parent.id) ?? [];
                            return (
                              <div
                                key={parent.id}
                                className="rounded-md border border-border/70 bg-background/35 px-2.5 py-2"
                              >
                                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Parent
                                </div>
                                <TicketWorkItemCard
                                  ticket={parent}
                                  compact
                                  flat
                                  childCount={children.length}
                                  onOpen={() => onOpenTicket(project.id, parent.id)}
                                />
                                {children.length > 0 && (
                                  <div className="mt-2 ml-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
                                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Children
                                    </div>
                                    <div className="space-y-1.5 border-l-2 border-border/70 pl-2">
                                      {children.map((child) => (
                                        <TicketWorkItemCard
                                          key={child.id}
                                          ticket={child}
                                          compact
                                          flat
                                          child
                                          onOpen={() => onOpenTicket(project.id, child.id)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        : column.items.map((ticket) => (
                            <TicketWorkItemCard
                              key={ticket.id}
                              ticket={ticket}
                              compact
                              flat
                              onOpen={() => onOpenTicket(project.id, ticket.id)}
                            />
                          ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : isHierarchyMode ? (
              viewMode === "list" ? (
                <div className="space-y-3">
                  {parentChildGroups.roots.map((parent) => {
                    const children = parentChildGroups.childrenByParentId.get(parent.id) ?? [];
                    return (
                      <div
                        key={parent.id}
                        className="rounded-md border border-border/70 bg-background/35 px-3 py-2.5"
                      >
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Parent
                        </div>
                        <TicketWorkItemRow
                          ticket={parent}
                          childCount={children.length}
                          onOpen={() => onOpenTicket(project.id, parent.id)}
                        />

                        {children.length > 0 && (
                          <div className="mt-2 ml-3 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
                            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Children
                            </div>
                            <div className="space-y-1.5 border-l-2 border-border/70 pl-2">
                              {children.map((child) => (
                                <TicketWorkItemRow
                                  key={child.id}
                                  ticket={child}
                                  child
                                  onOpen={() => onOpenTicket(project.id, child.id)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {parentChildGroups.unresolvedChildren.length > 0 && (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-2.5">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        Unlinked subtasks (parent not in current result set)
                      </div>
                      <div className="space-y-1.5">
                        {parentChildGroups.unresolvedChildren.map((child) => (
                          <TicketWorkItemRow
                            key={child.id}
                            ticket={child}
                            child
                            onOpen={() => onOpenTicket(project.id, child.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {parentChildGroups.roots.map((parent) => {
                    const children = parentChildGroups.childrenByParentId.get(parent.id) ?? [];
                    return (
                      <div
                        key={parent.id}
                        className="rounded-md border border-border/70 bg-background/35 px-2.5 py-2"
                      >
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Parent
                        </div>
                        <TicketWorkItemCard
                          ticket={parent}
                          flat
                          childCount={children.length}
                          onOpen={() => onOpenTicket(project.id, parent.id)}
                        />

                        {children.length > 0 && (
                          <div className="mt-2 ml-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
                            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Children
                            </div>
                            <div className="space-y-1.5 border-l-2 border-border/70 pl-2">
                              {children.map((child) => (
                                <TicketWorkItemCard
                                  key={child.id}
                                  ticket={child}
                                  compact
                                  flat
                                  child
                                  onOpen={() => onOpenTicket(project.id, child.id)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {parentChildGroups.unresolvedChildren.length > 0 && (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-2.5">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        Unlinked subtasks (parent not in current result set)
                      </div>
                      <div className="space-y-1.5">
                        {parentChildGroups.unresolvedChildren.map((child) => (
                          <TicketWorkItemCard
                            key={child.id}
                            ticket={child}
                            compact
                            flat
                            child
                            onOpen={() => onOpenTicket(project.id, child.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : viewMode === "list" ? (
              <div className="divide-y divide-border/70 rounded-md border border-border/70 bg-background/30">
                {filteredWorkItems.map((ticket) => (
                  <div key={ticket.id} className="px-3 py-2.5 transition-colors hover:bg-accent/30">
                    <TicketWorkItemRow
                      ticket={ticket}
                      onOpen={() => onOpenTicket(project.id, ticket.id)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredWorkItems.map((ticket) => (
                  <TicketWorkItemCard
                    key={ticket.id}
                    ticket={ticket}
                    flat
                    onOpen={() => onOpenTicket(project.id, ticket.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function TicketWorkItemCard({
  ticket,
  onOpen,
  compact,
  flat,
  child,
  childCount,
}: {
  ticket: ProjectTicket;
  onOpen: () => void;
  compact?: boolean;
  flat?: boolean;
  child?: boolean;
  childCount?: number;
}) {
  return (
    <button
      type="button"
      className={`block w-full text-left ${child ? "relative pl-3" : ""}`}
      onClick={onOpen}
    >
      {child && <span className="absolute top-2 left-0 h-px w-2 bg-border/70" aria-hidden />}
      <div
        className={`h-full rounded-md border transition-colors hover:bg-accent/30 ${
          child
            ? "border-dashed border-border/70 bg-muted/20"
            : flat
              ? "border-border/60 bg-background/30"
              : "border-border/70 bg-card/40"
        }`}
      >
        <div className={`flex h-full flex-col ${compact ? "gap-2 p-2.5" : "gap-3 p-3.5"}`}>
          <div className="flex items-start gap-2">
            <JiraIssueTypeIcon
              issueType={ticket.issueType}
              issueTypeIconUrl={ticket.issueTypeIconUrl ?? ticket.ref.issueTypeIconUrl}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {ticket.ref.displayId}
                </span>
                {child ? (
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Child
                  </span>
                ) : childCount ? (
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {childCount} child{childCount === 1 ? "" : "ren"}
                  </span>
                ) : null}
                <Badge
                  variant={child ? "outline" : "secondary"}
                  className="h-5 rounded px-1.5 text-[10px]"
                >
                  {ticket.status}
                </Badge>
                {ticket.priority && (
                  <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {ticket.priority}
                  </span>
                )}
              </div>
              <div
                className={`mt-1 font-medium ${compact ? "text-xs leading-4" : "text-sm leading-5"}`}
              >
                {ticket.ref.title}
              </div>
            </div>
          </div>

          {ticket.assignee && (
            <div className="mt-auto text-xs text-muted-foreground">
              Assigned to {ticket.assignee}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function TicketWorkItemRow({
  ticket,
  onOpen,
  child,
  childCount,
}: {
  ticket: ProjectTicket;
  onOpen: () => void;
  child?: boolean;
  childCount?: number;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-start gap-2 text-left ${child ? "relative pl-3" : ""}`}
      onClick={onOpen}
    >
      {child && <span className="absolute top-2 left-0 h-px w-2 bg-border/70" aria-hidden />}
      <JiraIssueTypeIcon
        issueType={ticket.issueType}
        issueTypeIconUrl={ticket.issueTypeIconUrl ?? ticket.ref.issueTypeIconUrl}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{ticket.ref.displayId}</span>
          {child ? (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Child
            </span>
          ) : childCount ? (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {childCount} child{childCount === 1 ? "" : "ren"}
            </span>
          ) : null}
          <Badge
            variant={child ? "outline" : "secondary"}
            className="h-5 rounded px-1.5 text-[10px]"
          >
            {ticket.status}
          </Badge>
          {ticket.priority && (
            <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ticket.priority}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm font-medium leading-5">{ticket.ref.title}</div>
        {ticket.assignee && (
          <div className="text-xs text-muted-foreground">Assigned to {ticket.assignee}</div>
        )}
      </div>
    </button>
  );
}

function ToggleGroup({
  value,
  onChange,
  options,
  wrap,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  wrap?: boolean;
}) {
  return (
    <div
      className={`inline-flex rounded-md border border-border/80 bg-background p-0.5 ${
        wrap ? "flex-wrap" : ""
      }`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            value === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TicketDetailView({
  project,
  ticketId,
  projectThreads,
  onOpenThread,
  onKickoffThread,
  onBack,
}: {
  project: ProjectShellProject;
  ticketId: string;
  projectThreads: ProjectThread[];
  onOpenThread: (projectId: string, threadId: string) => void;
  onKickoffThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
    kickoffMessage: string;
    kickoffModelSelection: ModelSelection;
    kickoffRuntimeMode: RuntimeMode;
    kickoffInteractionMode: ProviderInteractionMode;
  }) => void;
  onBack: () => void;
}) {
  const { tickets: projectTickets } = useProjectResources(project);
  const ticket = projectTickets.find((candidate) => candidate.id === ticketId);
  const resourceId = ticket?.ref.id ?? ticketId;
  const { snapshot, loading, error, reload } = useTicketDetail(project, resourceId);

  const issueType =
    ticket?.issueType ?? ticket?.ref.type ?? readIssueTypeFromSnapshotFields(snapshot?.fields);
  const displayId = ticket?.ref.displayId ?? snapshot?.ref.displayId ?? ticketId;
  const title = ticket?.ref.title ?? snapshot?.ref.title ?? "Ticket";
  const status = ticket?.status ?? (snapshot?.fields.status as string | undefined) ?? "Unknown";
  const priority =
    ticket?.priority ?? (snapshot?.fields.priority as string | undefined) ?? undefined;
  const assignee =
    ticket?.assignee ?? (snapshot?.fields.assignee as string | undefined) ?? undefined;
  const ticketUrl = ticket?.ref.url || snapshot?.ref.url || undefined;
  const htmlBaseUrl = useMemo(() => {
    if (!ticketUrl) return undefined;
    try {
      return new URL(ticketUrl).origin;
    } catch {
      return undefined;
    }
  }, [ticketUrl]);

  const descriptionMarkdown =
    (snapshot?.fields.description as string | undefined) ?? snapshot?.text;
  const descriptionHtml = snapshot?.fields.descriptionHtml as string | undefined;
  const attachments = Array.isArray(snapshot?.fields.attachments)
    ? (snapshot?.fields.attachments as Array<Record<string, unknown>>)
    : [];
  const comments = Array.isArray(snapshot?.fields.commentItems)
    ? (snapshot?.fields.commentItems as Array<Record<string, unknown>>)
    : [];

  const kickoffContext = useMemo(
    () =>
      buildTicketContextPrompt({
        projectTitle: project.title,
        displayId,
        title,
        status,
        ...(priority ? { priority } : {}),
        ...(assignee ? { assignee } : {}),
        ...(ticketUrl ? { ticketUrl } : {}),
        description: descriptionMarkdown ?? "",
      }),
    [project.title, displayId, title, status, priority, assignee, ticketUrl, descriptionMarkdown],
  );

  const issueThreads = projectThreads.filter((thread) => thread.ticketId === ticketId);

  const kickoff = useCallback(
    (
      instruction: string,
      kickoffModelSelection: ModelSelection,
      kickoffRuntimeMode: RuntimeMode,
      kickoffInteractionMode: ProviderInteractionMode,
    ) => {
      const kickoffMessage = `${kickoffContext}\n\nTask:\n${instruction}`;
      onKickoffThread({
        projectId: project.id,
        ticketId,
        ticketDisplayId: displayId,
        kickoffMessage,
        kickoffModelSelection,
        kickoffRuntimeMode,
        kickoffInteractionMode,
      });
    },
    [displayId, kickoffContext, onKickoffThread, project.id, ticketId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <Button size="icon-xs" variant="ghost" onClick={onBack} aria-label="Back to dashboard">
          <ArrowLeft className="size-4" />
        </Button>
        <JiraIssueTypeIcon issueType={issueType} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-1 min-w-0">
            <h2 className="truncate text-sm font-medium min-w-0">{displayId}</h2>
            <span className="ml-1 text-[10px] text-muted-foreground/75">{status}</span>
            {priority && (
              <span className="ml-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {priority}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground/80 mt-0.5">{title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          {ticketUrl && (
            <a href={ticketUrl} target="_blank" rel="noreferrer">
              <Button size="xs" variant="outline">
                <ExternalLink className="size-3.5" />
                Open Jira
              </Button>
            </a>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,36%)]">
        <section className="min-h-0 border-b border-border lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 sm:px-5">
              <TicketMetadata
                snapshot={snapshot}
                displayId={displayId}
                title={title}
                issueType={issueType}
                status={status}
                priority={priority}
                assignee={assignee}
              />

              {loading && (
                <Card>
                  <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading ticket details...
                  </CardContent>
                </Card>
              )}

              {error && (
                <Card>
                  <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
                </Card>
              )}

              <TicketRichContent
                {...(descriptionMarkdown ? { descriptionMarkdown } : {})}
                {...(descriptionHtml ? { descriptionHtml } : {})}
                {...(htmlBaseUrl ? { htmlBaseUrl } : {})}
                attachments={attachments.map((attachment) => ({
                  id: typeof attachment.id === "string" ? attachment.id : undefined,
                  filename:
                    typeof attachment.filename === "string" ? attachment.filename : undefined,
                  mimeType:
                    typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
                  content: typeof attachment.content === "string" ? attachment.content : undefined,
                  thumbnail:
                    typeof attachment.thumbnail === "string" ? attachment.thumbnail : undefined,
                  size: typeof attachment.size === "number" ? attachment.size : undefined,
                }))}
                comments={comments.map((comment) => ({
                  id: typeof comment.id === "string" ? comment.id : undefined,
                  author: typeof comment.author === "string" ? comment.author : undefined,
                  created: typeof comment.created === "string" ? comment.created : undefined,
                  updated: typeof comment.updated === "string" ? comment.updated : undefined,
                  bodyMarkdown:
                    typeof comment.bodyMarkdown === "string" ? comment.bodyMarkdown : undefined,
                  bodyHtml: typeof comment.bodyHtml === "string" ? comment.bodyHtml : undefined,
                }))}
              />
            </div>
          </ScrollArea>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-card/35">
          <TicketKickoffPanel
            displayId={displayId}
            issueThreads={issueThreads}
            onOpenThread={(threadId) => onOpenThread(project.id, threadId)}
            onKickoff={kickoff}
          />
        </aside>
      </div>
    </div>
  );
}

function TicketKickoffPanel({
  displayId,
  issueThreads,
  onOpenThread,
  onKickoff,
}: {
  displayId: string;
  issueThreads: ProjectThread[];
  onOpenThread: (threadId: string) => void;
  onKickoff: (
    instruction: string,
    selection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
  ) => void;
}) {
  const [prefill, setPrefill] = useState<string | undefined>(undefined);

  const recipeButtons = [
    {
      id: "summarize",
      title: "Understand the request",
      description: "Get a plain-language summary and highlight anything unclear.",
      prompt: "Summarize this ticket and list unknowns or ambiguities.",
    },
    {
      id: "implement",
      title: "Plan the work",
      description: "Break this into clear implementation steps with a safe rollout order.",
      prompt: "Propose a concrete implementation plan with impacted areas and rollout order.",
    },
    {
      id: "test",
      title: "Prepare testing",
      description: "Create practical QA and regression checks before shipping.",
      prompt: "Create a comprehensive QA and regression test plan for this ticket.",
    },
    {
      id: "comment",
      title: "Write a Jira update",
      description: "Draft a clear status comment you can quickly review and post.",
      prompt: "Draft a concise Jira update comment with current assumptions and next steps.",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h3 className="text-base font-semibold">Get Help With {displayId}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Start a new conversation with all ticket context included automatically.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4 sm:p-5">
          <section className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Quick starts
            </h4>
            <div className="space-y-2.5">
              {recipeButtons.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className="w-full rounded-md border border-border/70 bg-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/30"
                  onClick={() => setPrefill(recipe.prompt)}
                >
                  <div className="text-sm font-medium text-foreground/90">{recipe.title}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
                    {recipe.description}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2.5 pb-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Conversations
            </h4>
            {issueThreads.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground/70">
                No conversations started for this ticket yet.
              </p>
            )}
            {issueThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="block w-full text-left"
                onClick={() => onOpenThread(thread.id)}
              >
                <Card className="border-border/70 bg-transparent transition-colors hover:bg-accent/35">
                  <CardContent className="p-3.5">
                    <div className="truncate text-sm font-medium">{thread.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {thread.messageCount} messages • {formatRelativeTime(thread.lastMessageAt)}
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </section>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border bg-background/75 p-3 sm:p-4">
        <TicketKickoffComposer
          {...(prefill ? { prefillText: prefill } : {})}
          onSubmit={(text) => {
            onKickoff(text, DEFAULT_KICKOFF_SELECTION, DEFAULT_RUNTIME_MODE, "default");
            setPrefill(undefined);
          }}
        />
      </div>
    </div>
  );
}

function TicketKickoffComposer({
  prefillText,
  onSubmit,
}: {
  prefillText?: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(prefillText ?? "");

  useEffect(() => {
    if (prefillText !== undefined) {
      setText(prefillText);
    }
  }, [prefillText]);

  const handleSubmit = useCallback(() => {
    const next = text.trim();
    if (!next) return;
    onSubmit(next);
    setText("");
  }, [onSubmit, text]);

  return (
    <form
      className=""
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <div className="rounded-lg border border-border/70 bg-background/70">
        <Textarea
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[4rem] resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none outline-none"
          placeholder="What would you like help with for this ticket?"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <button
            type="submit"
            className="flex h-8 w-8 enabled:cursor-pointer items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 hover:bg-primary hover:scale-105 disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100"
            disabled={!text.trim()}
            aria-label="Start thread"
            title="Start thread"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}

function buildTicketContextPrompt(input: {
  projectTitle: string;
  displayId: string;
  title: string;
  status: string;
  priority?: string;
  assignee?: string;
  ticketUrl?: string;
  description: string;
}): string {
  const lines = [
    "You are helping with a Jira ticket. Use this context in your responses.",
    `Project: ${input.projectTitle}`,
    `Ticket: ${input.displayId}`,
    `Title: ${input.title}`,
    `Status: ${input.status}`,
    input.priority ? `Priority: ${input.priority}` : "",
    input.assignee ? `Assignee: ${input.assignee}` : "",
    input.ticketUrl ? `URL: ${input.ticketUrl}` : "",
    "",
    "Description:",
    input.description || "(No description available)",
    "",
    "Please summarize this ticket, identify risks, and propose a concrete implementation plan.",
  ];

  return lines.filter((line) => line.length > 0).join("\n");
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

function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectShellProject) => void;
}) {
  const setup = useCreateProject();
  const oauth = useAtlassianOAuth();
  const [siteUrl, setSiteUrl] = useState("https://");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [projectQuery, setProjectQuery] = useState("");

  useEffect(() => {
    void setup.loadPersistedAccounts();
  }, [setup]);

  useEffect(() => {
    if (oauth.state.kind !== "done") return;
    void setup.loadAccountsWithOAuth(oauth.state.sites, oauth.state.token);
  }, [oauth.state, setup]);

  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return setup.projects;
    return setup.projects.filter((project) => {
      const haystack = `${project.title} ${project.key ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [projectQuery, setup.projects]);

  const connectBasic = async () => {
    await setup.loadAccountsWithBasic({ siteUrl, email, apiToken });
  };

  const continueWithAccount = async () => {
    if (!setup.selectedAccount) return;
    await setup.loadProjects(setup.selectedAccount);
  };

  const createSelectedProject = async () => {
    if (!setup.selectedProject) return;
    const project = await setup.createProject(setup.selectedProject);
    onCreated(project);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-2 sm:items-center sm:p-4">
      <Card className="flex h-full w-full max-w-3xl flex-col overflow-hidden sm:h-[min(40rem,calc(100dvh-2rem))]">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderKanban className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Add Jira Project</h2>
          </div>
          <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close dialog">
            <X className="size-4" />
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {setup.error && (
              <Card>
                <CardContent className="p-3 text-sm text-destructive">{setup.error}</CardContent>
              </Card>
            )}

            {setup.step === "source" && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-sm font-semibold">Connect Atlassian</h3>
                  <Input
                    value={siteUrl}
                    onChange={(event) => setSiteUrl(event.target.value)}
                    placeholder="https://your-company.atlassian.net"
                  />
                  <Input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email"
                  />
                  <Input
                    type="password"
                    value={apiToken}
                    onChange={(event) => setApiToken(event.target.value)}
                    placeholder="API token"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => void connectBasic()}
                      disabled={!setup.isValidUrl(siteUrl)}
                    >
                      Connect with API token
                    </Button>
                    <Button variant="outline" onClick={() => void oauth.startOAuth()}>
                      Connect with OAuth
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {setup.step === "account" && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-sm font-semibold">Select Site</h3>
                  <div className="space-y-2">
                    {setup.accounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => setup.setSelectedAccount(account)}
                        className={`flex w-full items-center justify-between rounded-md border p-3 text-left ${
                          setup.selectedAccount?.id === account.id
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <span className="text-sm font-medium">{account.label}</span>
                        <span className="text-xs text-muted-foreground">{account.provider}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setup.setStep("source")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => void continueWithAccount()}
                      disabled={!setup.selectedAccount}
                    >
                      Continue
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {setup.step === "project" && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-sm font-semibold">Select Project</h3>
                  <Input
                    value={projectQuery}
                    onChange={(event) => setProjectQuery(event.target.value)}
                    placeholder="Filter projects"
                  />
                  <div className="space-y-2">
                    {filteredProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => setup.setSelectedProject(project)}
                        className={`flex w-full items-center justify-between rounded-md border p-3 text-left ${
                          setup.selectedProject?.id === project.id
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <div>
                          <div className="text-sm font-medium">{project.title}</div>
                          <div className="text-xs text-muted-foreground">{project.key}</div>
                        </div>
                        <Building2 className="size-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setup.setStep("account")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => void createSelectedProject()}
                      disabled={!setup.selectedProject}
                    >
                      Add project
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {setup.step === "creating" && (
              <Card>
                <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Creating project...
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
