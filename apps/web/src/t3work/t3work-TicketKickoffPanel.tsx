import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import type { BackendApi } from "~/t3work/backend/t3work-types";
import type { ProjectThread, T3workThreadToolId } from "~/t3work/t3work-types";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import { ContextAttachmentChip } from "~/t3work/components/t3work-ContextAttachmentChip";
import { T3workSidecarComposition } from "~/t3work/t3work-SidecarComposition";
import {
  applyT3workRecipeQuickStartLaunchCustomization,
  areT3workRecipeQuickStartLaunchCustomizationsEqual,
  buildT3workSelectedRecipeKickoffLaunch,
  type T3workSelectedRecipeQuickStart,
} from "~/t3work/t3work-recipeQuickStartLaunch";
import { type T3workKickoffComposerHandle } from "~/t3work/t3work-TicketKickoffComposer";
import { buildSidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";
import type { T3workSidecarRecipeInput } from "~/t3work/t3work-sidecarRecipeTypes";
import type { T3workKickoffWorkflow } from "~/t3work/t3work-types";

type TicketKickoffPanelProps = {
  profileId?: string;
  projectId: string;
  issueThreads: ProjectThread[];
  quickStartRecipeInput: T3workSidecarRecipeInput & {
    readonly backend: BackendApi | null;
  };
  injectedContextAttachments?: ReadonlyArray<T3WorkContextAttachment>;
  onOpenThread: (threadId: string) => void;
  onKickoff: (
    instruction: string,
    kickoffPending: boolean | undefined,
    selection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    selectedToolIds: ReadonlyArray<T3workThreadToolId>,
    contextAttachments: ReadonlyArray<T3WorkContextAttachment>,
    kickoffWorkflow?: T3workKickoffWorkflow,
  ) => void;
  renderComposer: (props: {
    composerRef: React.RefObject<T3workKickoffComposerHandle | null>;
    prefillText?: string;
    selectedRecipe?: T3workSelectedRecipeQuickStart;
    onClearSelectedRecipe?: () => void;
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
  profileId,
  projectId,
  issueThreads,
  quickStartRecipeInput,
  injectedContextAttachments,
  onOpenThread,
  onKickoff,
  renderComposer,
}: TicketKickoffPanelProps) {
  const [localContextAttachments, setLocalContextAttachments] = useState<
    ReadonlyArray<T3WorkContextAttachment>
  >([]);
  const composerRef = useRef<T3workKickoffComposerHandle | null>(null);
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedRecipe, setSelectedRecipe] = useState<T3workSelectedRecipeQuickStart | null>(null);
  const sidecarHost = useMemo(
    () =>
      buildSidecarSectionHost({
        placement: "sidecar.section",
        surface: "workitem.detail.sidepanel",
        projectId,
        stageKickoff: (recipe, customization) => {
          setSelectedRecipe((current) => {
            if (
              current?.recipe.id === recipe.id &&
              areT3workRecipeQuickStartLaunchCustomizationsEqual(
                current.customization,
                customization,
              )
            ) {
              return current;
            }

            return {
              recipe: applyT3workRecipeQuickStartLaunchCustomization(recipe, customization),
              ...(customization ? { customization } : {}),
            };
          });
        },
        openThread: onOpenThread,
      }),
    [onOpenThread, projectId],
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
      <ScrollArea className="min-h-0 flex-1">
        <T3workSidecarComposition
          surface="workitem.detail.sidepanel"
          profileId={profileId}
          host={sidecarHost}
          resolveSectionProps={(sectionId) => {
            if (sectionId === "quick-starts") {
              return {
                recipeInput: quickStartRecipeInput,
                ...(selectedRecipe?.recipe.id
                  ? { selectedRecipeId: selectedRecipe.recipe.id }
                  : {}),
              };
            }

            if (sectionId === "recent-conversations") {
              return {
                threads: issueThreads,
                emptyMessage: "No conversations started for this ticket yet.",
                showSearch: false,
                showCount: false,
              };
            }

            return undefined;
          }}
        />
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
          composerRef,
          ...(selectedRecipe ? { selectedRecipe } : {}),
          onClearSelectedRecipe: () => setSelectedRecipe(null),
          onSubmit: (text, selection, runtimeMode, interactionMode, selectedToolIds) => {
            const kickoff = selectedRecipe
              ? buildT3workSelectedRecipeKickoffLaunch({
                  selectedRecipe,
                  customMessage: text,
                })
              : {
                  kickoffMessage: text,
                  kickoffPending: true,
                };
            onKickoff(
              kickoff.kickoffMessage,
              kickoff.kickoffPending,
              selection,
              runtimeMode,
              interactionMode,
              selectedToolIds,
              localContextAttachments,
              selectedRecipe?.recipe.workflow,
            );
            setLocalContextAttachments([]);
            setDismissedAttachmentIds(new Set());
            setSelectedRecipe(null);
          },
        })}
      </div>
    </div>
  );
}
