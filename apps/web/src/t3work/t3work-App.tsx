import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BotIcon,
  CornerDownRight,
  EllipsisIcon,
  ExternalLink,
  GitBranch,
  LockIcon,
  LockOpenIcon,
  Loader2,
  PenLineIcon,
  Plus,
  RefreshCw,
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
import { useProjectResources } from "~/t3work/hooks/t3work-useProjectResources";
import { useProjectStore } from "~/t3work/hooks/t3work-useProjectStore";
import { useTicketDetail } from "~/t3work/hooks/t3work-useTicketDetail";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";
import { deriveProviderInstanceEntries, sortProviderInstanceEntries } from "~/providerInstances";
import { getProviderInteractionModeToggle } from "~/providerModels";
import { buildProjectTicketHierarchy } from "~/t3work/t3work-ticketHierarchy";
import { TicketMetadata } from "~/t3work/components/ticket/t3work-TicketMetadata";
import { TicketRichContent } from "~/t3work/components/ticket/t3work-TicketRichContent";
import {
  JiraIssueTypeIcon,
  readIssueTypeIconUrlFromSnapshotFields,
  readIssueTypeFromSnapshotFields,
} from "~/t3work/components/ticket/t3work-JiraIssueType";
import type { ProjectThread, ProjectTicket, ViewState } from "~/t3work/t3work-types";
import { DEFAULT_MODEL, DEFAULT_RUNTIME_MODE, ProviderInstanceId } from "@t3tools/contracts";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { LucideIcon } from "lucide-react";
import {
  AppProjectIcon,
  ConnectionStatusBadge,
  ProviderBadges,
} from "~/t3work/t3work-AppStatusBits";
import { buildTicketContextPrompt, formatRelativeTime } from "~/t3work/t3work-AppTicketHelpers";
import { CreateProjectDialog } from "~/t3work/t3work-CreateProjectDialog";
import { AppMainContent } from "~/t3work/t3work-AppMainContent";
import {
  TicketWorkItemCard,
  TicketWorkItemRow,
  ToggleGroup,
} from "~/t3work/t3work-ProjectDashboardItemViews";
import { TicketKickoffPanel as TicketKickoffPanelView } from "~/t3work/t3work-TicketKickoffPanel";

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

const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

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
        <AppMainContent
          view={activeView}
          projects={store.projects}
          getThreadsForProject={store.getThreadsForProject}
          onOpenTicket={handleSelectTicket}
          onOpenThread={handleSelectThread}
          onKickoffTicketThread={handleCreateTicketKickoffThread}
          onThreadKickoffConsumed={handleThreadKickoffConsumed}
          onBackToDashboard={handleSelectProject}
          onCreate={() => setShowCreate(true)}
          renderDashboard={(project) => (
            <ProjectDashboard project={project} tickets={[]} onOpenTicket={handleSelectTicket} />
          )}
          renderTicketDetail={(project, ticketId) => (
            <TicketDetailView
              project={project}
              ticketId={ticketId}
              projectThreads={store.getThreadsForProject(project.id)}
              onOpenThread={handleSelectThread}
              onKickoffThread={handleCreateTicketKickoffThread}
              onBack={() => handleSelectProject(project.id)}
            />
          )}
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <AppProjectIcon project={project} />
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
                                <TicketWorkItemCard
                                  ticket={parent}
                                  compact
                                  flat
                                  childCount={children.length}
                                  onOpen={() => onOpenTicket(project.id, parent.id)}
                                />
                                {children.length > 0 && (
                                  <div className="mt-2 ml-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
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
                        <TicketWorkItemRow
                          ticket={parent}
                          childCount={children.length}
                          onOpen={() => onOpenTicket(project.id, parent.id)}
                        />

                        {children.length > 0 && (
                          <div className="mt-2 ml-3 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
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
                        Unlinked subtasks
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
                        <TicketWorkItemCard
                          ticket={parent}
                          flat
                          childCount={children.length}
                          onOpen={() => onOpenTicket(project.id, parent.id)}
                        />

                        {children.length > 0 && (
                          <div className="mt-2 ml-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
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
                        Unlinked subtasks
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
  const issueTypeIconUrl =
    ticket?.issueTypeIconUrl ??
    ticket?.ref.issueTypeIconUrl ??
    readIssueTypeIconUrlFromSnapshotFields(snapshot?.fields);
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
        <JiraIssueTypeIcon issueType={issueType} issueTypeIconUrl={issueTypeIconUrl} />
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
          <TicketKickoffPanelContainer
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

function TicketKickoffPanelContainer({
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
  const backendState = useBackendState();
  return (
    <TicketKickoffPanelView
      displayId={displayId}
      issueThreads={issueThreads}
      onOpenThread={onOpenThread}
      onKickoff={onKickoff}
      renderComposer={({ prefillText, onSubmit }) => (
        <TicketKickoffComposer
          {...(prefillText ? { prefillText } : {})}
          providers={backendState.providers}
          isConnected={backendState.connectionStatus === "connected"}
          onSubmit={onSubmit}
        />
      )}
    />
  );
}

function TicketKickoffComposer({
  prefillText,
  providers,
  isConnected,
  onSubmit,
}: {
  prefillText?: string;
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  onSubmit: (
    text: string,
    selection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
  ) => void;
}) {
  const availableProviders = useMemo(
    () =>
      providers.filter((provider) => provider.enabled && provider.availability !== "unavailable"),
    [providers],
  );

  const providerInstanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(availableProviders)),
    [availableProviders],
  );

  const modelOptionsByInstance = useMemo(() => {
    const options = new Map();
    for (const entry of providerInstanceEntries) {
      options.set(
        entry.instanceId,
        entry.models.map((model) => ({
          slug: model.slug,
          name: model.name,
          isCustom: model.isCustom,
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        })),
      );
    }
    return options;
  }, [providerInstanceEntries]);

  const [text, setText] = useState(prefillText ?? "");
  const [cursor, setCursor] = useState((prefillText ?? "").length);
  const [selectedInstanceId, setSelectedInstanceId] = useState(
    DEFAULT_KICKOFF_SELECTION.instanceId,
  );
  const [selectedModel, setSelectedModel] = useState(DEFAULT_KICKOFF_SELECTION.model);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null);

  useEffect(() => {
    if (prefillText !== undefined) {
      setText(prefillText);
      setCursor(prefillText.length);
    }
  }, [prefillText]);

  useEffect(() => {
    if (providerInstanceEntries.length === 0) {
      return;
    }
    const hasCurrent = providerInstanceEntries.some(
      (entry) => entry.instanceId === selectedInstanceId,
    );
    if (!hasCurrent) {
      setSelectedInstanceId(providerInstanceEntries[0]!.instanceId);
    }
  }, [providerInstanceEntries, selectedInstanceId]);

  const selectedProviderEntry = useMemo(
    () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
    [providerInstanceEntries, selectedInstanceId],
  );

  const selectedProvider = selectedProviderEntry?.snapshot;
  const selectedProviderModels = selectedProviderEntry?.models ?? [];

  useEffect(() => {
    const models = selectedProviderModels;
    if (models.length === 0) {
      setSelectedModel(DEFAULT_MODEL);
      return;
    }
    if (!models.some((model) => model.slug === selectedModel)) {
      setSelectedModel(models[0]!.slug);
    }
  }, [selectedModel, selectedProviderModels]);

  const showInteractionModeToggle = selectedProviderEntry
    ? getProviderInteractionModeToggle(availableProviders, selectedProviderEntry.driverKind)
    : true;

  const handleSubmit = useCallback(() => {
    const next = text.trim();
    if (!next || !isConnected || !selectedProviderEntry) return;
    onSubmit(
      next,
      {
        instanceId: selectedProviderEntry.instanceId,
        model: selectedModel,
      },
      runtimeMode,
      interactionMode,
    );
    setText("");
    setCursor(0);
  }, [
    interactionMode,
    isConnected,
    onSubmit,
    runtimeMode,
    selectedModel,
    selectedProviderEntry,
    text,
  ]);

  const runtimeOption = runtimeModeConfig[runtimeMode];
  const RuntimeModeIcon = runtimeOption.icon;
  const canSend = Boolean(text.trim()) && isConnected && Boolean(selectedProviderEntry);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      className="mx-auto w-full min-w-0 max-w-208"
      data-chat-composer-form="true"
    >
      <div className="group rounded-[22px] p-px transition-colors duration-200">
        <div
          className={cn(
            "rounded-[20px] border bg-card transition-colors duration-200 has-focus-visible:border-ring/45",
            "border-border",
            !isConnected ? "opacity-75" : null,
          )}
        >
          <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
            <ComposerPromptEditor
              editorRef={editorRef}
              value={text}
              cursor={cursor}
              terminalContexts={[]}
              skills={selectedProvider?.skills ?? []}
              onRemoveTerminalContext={() => {}}
              onChange={(nextValue, nextCursor) => {
                setText(nextValue);
                setCursor(nextCursor);
              }}
              onPaste={() => {}}
              placeholder={
                isConnected
                  ? "Ask anything, @tag files/folders, $use skills, or / for commands"
                  : "Server is disconnected"
              }
              disabled={!isConnected}
            />
          </div>

          <div
            data-chat-composer-footer="true"
            data-chat-composer-footer-compact="false"
            className="flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-2.5 pb-2.5 sm:gap-0 sm:px-3 sm:pb-3"
          >
            <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ProviderModelPicker
                activeInstanceId={selectedInstanceId}
                model={selectedModel}
                lockedProvider={null}
                instanceEntries={providerInstanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                disabled={!isConnected || !selectedProviderEntry}
                onInstanceModelChange={(instanceId, model) => {
                  setSelectedInstanceId(instanceId);
                  setSelectedModel(model);
                }}
              />

              {showInteractionModeToggle ? (
                <>
                  <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                  <Button
                    variant="ghost"
                    className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setInteractionMode((mode) => (mode === "plan" ? "default" : "plan"))
                    }
                    title={
                      interactionMode === "plan"
                        ? "Plan mode - click to return to normal build mode"
                        : "Default mode - click to enter plan mode"
                    }
                  >
                    <BotIcon />
                    <span className="sr-only sm:not-sr-only">
                      {interactionMode === "plan" ? "Plan" : "Build"}
                    </span>
                  </Button>
                </>
              ) : null}

              <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
              <Select value={runtimeMode} onValueChange={(value) => setRuntimeMode(value!)}>
                <SelectTrigger
                  variant="ghost"
                  size="sm"
                  className="font-medium"
                  aria-label="Runtime mode"
                  title={runtimeOption.description}
                >
                  <RuntimeModeIcon className="size-4" />
                  <SelectValue>{runtimeOption.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const OptionIcon = option.icon;
                    return (
                      <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                        <div className="grid min-w-0 gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                            <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            {option.label}
                          </span>
                          <span className="text-muted-foreground text-xs leading-4">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </div>

            <div
              data-chat-composer-actions="right"
              data-chat-composer-primary-actions-compact="false"
              className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
            >
              <ComposerPrimaryActions
                compact={false}
                pendingAction={null}
                isRunning={false}
                showPlanFollowUpPrompt={false}
                promptHasText={text.trim().length > 0}
                isSendBusy={false}
                isConnecting={false}
                isEnvironmentUnavailable={!isConnected || !selectedProviderEntry}
                isPreparingWorktree={false}
                hasSendableContent={canSend}
                onPreviousPendingQuestion={() => {}}
                onInterrupt={() => {}}
                onImplementPlanInNewThread={() => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
