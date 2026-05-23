import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";

import { ContextAttachmentChip } from "~/t3work/components/t3work-ContextAttachmentChip";
import { TicketKickoffComposer } from "~/t3work/t3work-TicketKickoffComposer";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import type { T3workThreadToolId } from "~/t3work/t3work-types";

export function ProjectDashboardKickoffComposer(input: {
  prefillText?: string;
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  injectedContextAttachments: ReadonlyArray<T3WorkContextAttachment>;
  onRemoveContextAttachment: (id: string) => void;
  onSubmit: (
    text: string,
    selection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    selectedToolIds: ReadonlyArray<T3workThreadToolId>,
  ) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-background/75 p-3 sm:p-4">
      {input.injectedContextAttachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {input.injectedContextAttachments.map((attachment) => (
            <ContextAttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={input.onRemoveContextAttachment}
            />
          ))}
        </div>
      ) : null}
      <TicketKickoffComposer
        {...(input.prefillText ? { prefillText: input.prefillText } : {})}
        providers={input.providers}
        isConnected={input.isConnected}
        onSubmit={input.onSubmit}
      />
    </div>
  );
}
