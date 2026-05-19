import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { ProjectShellProject } from "@t3tools/project-context";
import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { Input } from "~/t3work/components/ui/t3work-input";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import { useT3WorkAddToChatStore } from "~/t3work/t3work-addToChatStore";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { formatRelativeTime } from "~/t3work/t3work-AppTicketHelpers";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import { ProjectDashboardKickoffComposer } from "~/t3work/t3work-ProjectDashboardKickoffComposer";
import { PROJECT_DASHBOARD_KICKOFF_QUICK_STARTS } from "~/t3work/t3work-projectDashboardKickoffQuickStarts";
import type { ProjectThread } from "~/t3work/t3work-types";

export function ProjectDashboardKickoffAside({
  project,
  projectThreads,
  providers,
  isConnected,
  onOpenThread,
  onKickoffThread,
}: {
  project: ProjectShellProject;
  projectThreads: ProjectThread[];
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  onOpenThread: (threadId: string) => void;
  onKickoffThread: (
    kickoffMessage: string,
    kickoffModelSelection: ModelSelection,
    kickoffRuntimeMode: RuntimeMode,
    kickoffInteractionMode: ProviderInteractionMode,
    kickoffContextAttachments: ReadonlyArray<T3WorkContextAttachment>,
  ) => void;
}) {
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

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border/70">
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
            <div className="space-y-2.5">
              {PROJECT_DASHBOARD_KICKOFF_QUICK_STARTS.map((quickStart) => (
                <button
                  key={quickStart.id}
                  type="button"
                  className="w-full rounded-md border border-border/70 bg-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/30"
                  onClick={() => setPrefillText(quickStart.prompt)}
                >
                  <div className="text-sm font-medium text-foreground/90">{quickStart.title}</div>
                </button>
              ))}
            </div>
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

      <ProjectDashboardKickoffComposer
        {...(prefillText ? { prefillText } : {})}
        providers={providers}
        isConnected={isConnected}
        injectedContextAttachments={injectedContextAttachments}
        onRemoveContextAttachment={removeContextAttachment}
        onSubmit={(text, selection, runtimeMode, interactionMode) => {
          onKickoffThread(
            text,
            selection,
            runtimeMode,
            interactionMode,
            injectedContextAttachments,
          );
          setPrefillText(undefined);
          setInjectedContextAttachments([]);
          setDismissedAttachmentIds(new Set());
        }}
      />
    </aside>
  );
}
