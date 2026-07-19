import { CornerDownRightIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "../ui/button";

export interface ComposerQueuedMessage {
  readonly id: string;
  readonly text: string;
}

export function ComposerQueuedMessages(props: {
  readonly messages: ReadonlyArray<ComposerQueuedMessage>;
  readonly disabled: boolean;
  readonly onSteer: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onEdit: (id: string) => void;
}) {
  if (props.messages.length === 0) return null;

  return (
    <div
      className="relative z-0 max-h-44 overflow-y-auto rounded-t-[20px] rounded-b-none border border-b-0 border-border bg-card px-3 py-1 shadow-sm"
      aria-label="Queued messages"
    >
      {props.messages.map((message) => (
        <div key={message.id} className="flex min-h-8 items-center gap-2 text-sm">
          <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
          <span className="min-w-0 flex-1 truncate text-foreground/90">{message.text}</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-7 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
            disabled={props.disabled}
            onClick={() => props.onSteer(message.id)}
            aria-label={`Steer queued message: ${message.text}`}
          >
            <span aria-hidden="true">→</span>
            Steer
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => props.onDelete(message.id)}
            aria-label={`Delete queued message: ${message.text}`}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-7 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => props.onEdit(message.id)}
            aria-label={`Edit queued message: ${message.text}`}
          >
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
        </div>
      ))}
    </div>
  );
}
