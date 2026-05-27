import { useEffect, useState } from "react";
import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import type { ProjectThread, T3workThreadToolId } from "~/t3work/t3work-types";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { formatRelativeTime } from "./t3work-AppTicketHelpers";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import { ContextAttachmentChip } from "~/t3work/components/t3work-ContextAttachmentChip";
import { T3workKickoffRecipeList } from "~/t3work/t3work-KickoffRecipeList";
import type { T3workSidecarRecipeQuickStart } from "~/t3work/t3work-sidecarRecipes";

type TicketKickoffPanelProps = {
  displayId: string;
  issueThreads: ProjectThread[];
  quickStartRecipes: ReadonlyArray<T3workSidecarRecipeQuickStart>;
  injectedContextAttachments?: ReadonlyArray<T3WorkContextAttachment>;
  onOpenThread: (threadId: string) => void;
  onKickoff: (
    instruction: string,
    selection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    selectedToolIds: ReadonlyArray<T3workThreadToolId>,
    contextAttachments: ReadonlyArray<T3WorkContextAttachment>,
  ) => void;
  renderComposer: (props: {
    prefillText?: string;
    onSubmit: (
      text: string,
      selection: ModelSelection,
      runtimeMode: RuntimeMode,
      interactionMode: ProviderInteractionMode,
      selectedToolIds: ReadonlyArray<T3workThreadToolId>,
    ) => void;
  }) => React.ReactNode;
};

export function TicketKickoffPanel({
  displayId,
  issueThreads,
  quickStartRecipes,
  injectedContextAttachments,
  onOpenThread,
  onKickoff,
  renderComposer,
}: TicketKickoffPanelProps) {
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [localContextAttachments, setLocalContextAttachments] = useState<
    ReadonlyArray<T3WorkContextAttachment>
  >([]);
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!injectedContextAttachments || injectedContextAttachments.length === 0) {
      return;
    }
    setLocalContextAttachments((current) =>
      mergeContextAttachmentsById({
        current,
        incoming: injectedContextAttachments,
        dismissedIds: dismissedAttachmentIds,
      }),
    );
  }, [dismissedAttachmentIds, injectedContextAttachments]);

  const removeLocalContextAttachment = (id: string) => {
    setLocalContextAttachments((current) => current.filter((a) => a.id !== id));
    setDismissedAttachmentIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

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
            <T3workKickoffRecipeList
              recipes={quickStartRecipes}
              onSelectRecipe={(recipe) => setPrefill(recipe.prompt)}
            />
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
        {localContextAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {localContextAttachments.map((a) => (
              <ContextAttachmentChip
                key={a.id}
                attachment={a}
                onRemove={removeLocalContextAttachment}
              />
            ))}
          </div>
        )}
        {renderComposer({
          ...(prefill ? { prefillText: prefill } : {}),
          onSubmit: (text, selection, runtimeMode, interactionMode, selectedToolIds) => {
            onKickoff(
              text,
              selection,
              runtimeMode,
              interactionMode,
              selectedToolIds,
              localContextAttachments,
            );
            setPrefill(undefined);
            setLocalContextAttachments([]);
            setDismissedAttachmentIds(new Set());
          },
        })}
      </div>
    </div>
  );
}
