import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconPencil,
  IconTrash,
  IconCornerDownRight,
  IconPlayerStopFilled,
  IconCheck,
  IconCircle,
  IconCircleDot,
  IconCircleMinus,
} from "@tabler/icons-react";
import type { TurnId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TurnDiffSummary } from "../../types";
import type { ActiveTodosState, TodoItem } from "../../session-logic";
import { cn } from "~/lib/utils";

export type QueuedMessagePanelItem = {
  readonly id: string;
  readonly text: string;
};

export type QueuedMessageDiffSummary = {
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
};

function summarizeTurnDiff(summary: TurnDiffSummary | null): {
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
} {
  if (!summary) {
    return { fileCount: 0, additions: 0, deletions: 0 };
  }
  return summary.files.reduce(
    (acc, file) => ({
      fileCount: acc.fileCount + 1,
      additions: acc.additions + (file.additions ?? 0),
      deletions: acc.deletions + (file.deletions ?? 0),
    }),
    { fileCount: 0, additions: 0, deletions: 0 },
  );
}

function QueuedMessageRow(props: {
  item: QueuedMessagePanelItem;
  supportsSteering: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onSteer: (id: string) => void;
  onInterruptAndSend: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "flex min-h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lg/10",
      )}
    >
      <button
        type="button"
        aria-label="Reorder queued message"
        className="-ml-1 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="size-3.5" />
      </button>
      <IconCornerDownRight className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {props.item.text}
      </span>
      {props.supportsSteering ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => props.onSteer(props.item.id)}
        >
          <IconCornerDownRight className="size-3.5" />
          Steer
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => props.onInterruptAndSend(props.item.id)}
              />
            }
          >
            <IconPlayerStopFilled className="size-3.5" />
            Interrupt
          </TooltipTrigger>
          <TooltipPopup side="top">Interrupt the current turn and send this message</TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => props.onEdit(props.item.id)}
              aria-label="Edit queued message"
            />
          }
        >
          <IconPencil />
        </TooltipTrigger>
        <TooltipPopup side="top">Edit queued message</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => props.onDelete(props.item.id)}
              aria-label="Delete queued message"
            />
          }
        >
          <IconTrash />
        </TooltipTrigger>
        <TooltipPopup side="top">Delete queued message</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function todoStatusIcon(status: TodoItem["status"]) {
  switch (status) {
    case "completed":
      return <IconCheck className="size-3.5 text-emerald-400" />;
    case "in_progress":
      return <IconCircleDot className="size-3.5 text-amber-400" />;
    case "cancelled":
      return <IconCircleMinus className="size-3.5 text-muted-foreground/50" />;
    default:
      return <IconCircle className="size-3.5 text-muted-foreground/45" />;
  }
}

function TodoList({ todos }: { todos: ReadonlyArray<TodoItem> }) {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return (
    <div className="border-b border-border/35 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Tasks ({completed}/{todos.length})
      </div>
      <ul className="flex flex-col gap-1">
        {todos.map((todo) => {
          const status = todo.status ?? "pending";
          return (
            <li key={todo.content} className="flex items-start gap-2 text-xs leading-5">
              <span className="mt-0.5 shrink-0">{todoStatusIcon(status)}</span>
              <span
                className={cn(
                  "min-w-0 wrap-break-word",
                  status === "completed"
                    ? "text-muted-foreground/55 line-through"
                    : status === "cancelled"
                      ? "text-muted-foreground/45 line-through"
                      : status === "in_progress"
                        ? "text-foreground/90"
                        : "text-muted-foreground/80",
                )}
              >
                {todo.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function QueuedMessagesPanel(props: {
  activeTurnId: TurnId | null;
  activeTurnDiffSummary: TurnDiffSummary | null;
  activeChangeSummary: QueuedMessageDiffSummary | null;
  activeTodos: ActiveTodosState | null;
  items: readonly QueuedMessagePanelItem[];
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onReviewDiff: () => void;
  onReorder: (ids: readonly string[]) => void;
  supportsSteering: boolean;
  onSteer: (id: string) => void;
  onInterruptAndSend: (id: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const diffSummary = props.activeChangeSummary ?? summarizeTurnDiff(props.activeTurnDiffSummary);
  const todos = props.activeTodos?.todos ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const ids = props.items.map((item) => item.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    props.onReorder(arrayMove(ids, oldIndex, newIndex));
  };

  // The panel is tied to an active turn: it surfaces the running turn's diff
  // count and any messages queued behind it. With no active turn there is
  // nothing to review or steer, so the panel is hidden entirely.
  if (!props.activeTurnId) {
    return null;
  }
  if (props.items.length === 0 && diffSummary.fileCount === 0 && todos.length === 0) {
    return null;
  }

  return (
    <div
      className="mx-auto -mb-px w-[calc(100%-2.5rem)] min-w-0 overflow-hidden rounded-b-none rounded-t-[20px] border border-border/45 bg-card text-card-foreground"
      data-testid="queued-messages-panel"
    >
      <div
        className={cn(
          "flex min-h-9 items-center gap-2 px-3 text-xs",
          props.items.length > 0 || todos.length > 0 ? "border-b border-border/35" : null,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {diffSummary.fileCount} {diffSummary.fileCount === 1 ? "file" : "files"} changed{" "}
          <span className="text-emerald-400">+{diffSummary.additions}</span>{" "}
          <span className="text-red-400">-{diffSummary.deletions}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-foreground"
          disabled={!props.activeTurnId}
          onClick={() => {
            props.onReviewDiff();
          }}
        >
          Review
        </Button>
      </div>
      {todos.length > 0 ? <TodoList todos={todos} /> : null}
      {props.items.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={props.items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-border/45">
              {props.items.map((item) => (
                <QueuedMessageRow
                  key={item.id}
                  item={item}
                  supportsSteering={props.supportsSteering}
                  onDelete={props.onDelete}
                  onEdit={props.onEdit}
                  onSteer={props.onSteer}
                  onInterruptAndSend={props.onInterruptAndSend}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}
    </div>
  );
}
