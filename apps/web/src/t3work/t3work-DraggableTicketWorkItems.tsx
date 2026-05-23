import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { useT3WorkAgentContextDrag } from "~/t3work/t3work-agentContextDrag";
import { TicketWorkItemCard, TicketWorkItemRow } from "~/t3work/t3work-ProjectDashboardItemViews";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";

type TicketCardProps = ComponentProps<typeof TicketWorkItemCard>;
type TicketRowProps = ComponentProps<typeof TicketWorkItemRow>;

function DraggableTicketShell({
  capabilities,
  dragLabel,
  children,
}: {
  capabilities: AgentContextCapabilities | null;
  dragLabel: string;
  children: React.ReactNode;
}) {
  const dragProps = useT3WorkAgentContextDrag({ capabilities, label: dragLabel });

  return (
    <div
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      className={cn(dragProps.draggable ? "cursor-grab active:cursor-grabbing" : null, "min-w-0")}
      data-t3work-agent-context-drag-source={dragProps.draggable ? "true" : undefined}
    >
      {children}
    </div>
  );
}

export function DraggableTicketWorkItemCard(
  props: TicketCardProps & { capabilities: AgentContextCapabilities | null; dragLabel: string },
) {
  const { capabilities, dragLabel, ...cardProps } = props;

  return (
    <DraggableTicketShell capabilities={capabilities} dragLabel={dragLabel}>
      <TicketWorkItemCard {...cardProps} />
    </DraggableTicketShell>
  );
}

export function DraggableTicketWorkItemRow(
  props: TicketRowProps & { capabilities: AgentContextCapabilities | null; dragLabel: string },
) {
  const { capabilities, dragLabel, ...rowProps } = props;

  return (
    <DraggableTicketShell capabilities={capabilities} dragLabel={dragLabel}>
      <TicketWorkItemRow {...rowProps} />
    </DraggableTicketShell>
  );
}
