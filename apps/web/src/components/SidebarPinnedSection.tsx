import { useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessagesSquareIcon, XIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { useTheme } from "../hooks/useTheme";
import { usePinnedItemsStore, type PinnedItem } from "../pinnedItemsStore";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";

export function SidebarPinnedSection() {
  const items = usePinnedItemsStore((state) => state.items);
  const reorder = usePinnedItemsStore((state) => state.reorder);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (items.length === 0) {
    return null;
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  };

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      <SidebarMenu>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <PinnedRow key={item.id} item={item} />
            ))}
          </SortableContext>
        </DndContext>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function PinnedRow(props: { item: PinnedItem }) {
  const { item } = props;
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const unpin = usePinnedItemsStore((state) => state.unpin);
  const { isMobile, setOpenMobile } = useSidebar();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const label = item.kind === "chat" ? item.title : item.name;

  const open = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (item.kind === "chat") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: item.environmentId, threadId: item.threadId },
      });
      return;
    }
    void navigate({
      to: "/editor/$environmentId/$projectId",
      params: { environmentId: item.environmentId, projectId: item.projectId },
      search: item.kind === "file" ? { file: item.path } : { reveal: item.path },
    });
  };

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/pinned relative", isDragging && "z-10 opacity-80")}
    >
      <button
        type="button"
        onClick={open}
        title={item.kind === "chat" ? item.title : item.path}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/90 hover:bg-accent hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        {item.kind === "chat" ? (
          <MessagesSquareIcon className="size-4 shrink-0 text-muted-foreground/70" />
        ) : (
          <VscodeEntryIcon
            pathValue={item.path}
            kind={item.kind}
            theme={resolvedTheme}
            className="size-4 shrink-0"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label="Unpin"
        onClick={() => unpin(item.id)}
        className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 items-center justify-center rounded p-0.5 text-muted-foreground/70 hover:bg-secondary hover:text-foreground group-hover/pinned:flex"
      >
        <XIcon className="size-3.5" />
      </button>
    </SidebarMenuItem>
  );
}
