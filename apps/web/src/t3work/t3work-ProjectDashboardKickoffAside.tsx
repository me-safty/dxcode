import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { Input } from "~/t3work/components/ui/t3work-input";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import type { ProjectDashboardKickoffAsideProps } from "~/t3work/t3work-ProjectDashboardKickoffAsideTypes";
import { useT3WorkAddToChatStore } from "~/t3work/t3work-addToChatStore";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { formatRelativeTime } from "~/t3work/t3work-AppTicketHelpers";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import { EmbeddedThreadAside } from "~/t3work/t3work-EmbeddedThreadAside";
import { readProjectSetupProfileIdFromProject } from "~/t3work/hooks/t3work-createProjectBootstrap";
import { T3workKickoffRecipeList } from "~/t3work/t3work-KickoffRecipeList";
import { ProjectDashboardKickoffComposer } from "~/t3work/t3work-ProjectDashboardKickoffComposer";
import { runT3workViewTransition } from "~/t3work/t3work-runViewTransition";
import { buildT3workSidecarRecipeQuickStarts } from "~/t3work/t3work-sidecarRecipes";

export function ProjectDashboardKickoffAside({
  project,
  projectThreads,
  activeThread,
  providers,
  isConnected,
  onOpenThread,
  onOpenFullThread,
  onThreadKickoffConsumed,
  onKickoffThread,
}: ProjectDashboardKickoffAsideProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [prefillText, setPrefillText] = useState<string | undefined>(undefined);
  const [injectedContextAttachments, setInjectedContextAttachments] = useState<
    readonly T3WorkContextAttachment[]
  >([]);
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const pendingProjectContextCount = useT3WorkAddToChatStore(
    (state) => (state.pendingByProjectId[project.id] ?? []).length,
  );

  useEffect(() => {
    if (pendingProjectContextCount === 0) {
      return;
    }
    const drained = useT3WorkAddToChatStore.getState().drainProject(project.id);
    if (drained.length === 0) {
      return;
    }
    setInjectedContextAttachments((current) =>
      mergeContextAttachmentsById({
        current,
        incoming: drained.map((item) => item.attachment),
        dismissedIds: dismissedAttachmentIds,
      }),
    );
  }, [dismissedAttachmentIds, pendingProjectContextCount, project.id]);

  const removeContextAttachment = (id: string) => {
    setInjectedContextAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
    setDismissedAttachmentIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const recentThreads = useMemo(
    () =>
      projectThreads.toSorted(
        (left, right) =>
          new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
      ),
    [projectThreads],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const quickStartRecipes = useMemo(
    () =>
      buildT3workSidecarRecipeQuickStarts({
        surface: "project.dashboard",
        project,
        profileId: readProjectSetupProfileIdFromProject(project),
        selectedWorkLabel: project.title,
        availableContextKeys: ["project.summary"],
      }),
    [project],
  );
  const filteredThreads = useMemo(() => {
    if (!normalizedQuery) {
      return recentThreads;
    }
    return recentThreads.filter((thread) => {
      const title = thread.title.toLowerCase();
      const ticketId = (thread.ticketId ?? "").toLowerCase();
      return title.includes(normalizedQuery) || ticketId.includes(normalizedQuery);
    });
  }, [normalizedQuery, recentThreads]);

  if (activeThread) {
    return (
      <EmbeddedThreadAside
        thread={activeThread}
        projectId={project.id}
        projectTitle={project.title}
        {...(project.workspace?.rootPath
          ? { projectWorkspaceRoot: project.workspace.rootPath }
          : {})}
        {...(onOpenFullThread ? { onOpenFullThread: () => onOpenFullThread(activeThread.id) } : {})}
        onThreadKickoffConsumed={onThreadKickoffConsumed}
      />
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/70 bg-background [view-transition-name:t3work-right-sidebar-panel]">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h3 className="text-base font-semibold">Kick off a project thread</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Start a focused conversation for {project.title} and continue it in full thread view.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4 sm:p-5">
          <section className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Quick starts
            </h4>
            <T3workKickoffRecipeList
              recipes={quickStartRecipes}
              onSelectRecipe={(recipe) => setPrefillText(recipe.prompt)}
            />
          </section>

          <section className="space-y-2.5 pb-1">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                Recent conversations
              </h4>
              <span className="text-xs text-muted-foreground/70">{filteredThreads.length}</span>
            </div>

            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search conversations"
                className="h-8 pl-8"
              />
            </div>

            {filteredThreads.length === 0 ? (
              <p className="px-1 py-1 text-xs text-muted-foreground/70">
                No matching conversations.
              </p>
            ) : null}

            {filteredThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="block w-full text-left"
                onClick={() => runT3workViewTransition(() => onOpenThread(thread.id))}
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

      <ProjectDashboardKickoffComposer
        {...(prefillText ? { prefillText } : {})}
        providers={providers}
        isConnected={isConnected}
        injectedContextAttachments={injectedContextAttachments}
        onRemoveContextAttachment={removeContextAttachment}
        onSubmit={(text, selection, runtimeMode, interactionMode, selectedToolIds) => {
          runT3workViewTransition(() => {
            onKickoffThread(
              text,
              selection,
              runtimeMode,
              interactionMode,
              selectedToolIds,
              injectedContextAttachments,
            );
            setPrefillText(undefined);
            setInjectedContextAttachments([]);
            setDismissedAttachmentIds(new Set());
          });
        }}
      />
    </aside>
  );
}
