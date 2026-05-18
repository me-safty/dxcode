import { TicketWorkItemCard } from "~/t3work/t3work-ProjectDashboardItemViews";
import { T3SurfacePanel } from "~/t3work/components/ui/t3work-surface";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function ProjectDashboardChildrenCards({
  children,
  projectId,
  onOpenTicket,
}: {
  children: readonly ProjectTicket[];
  projectId: string;
  onOpenTicket: (projectId: string, ticketId: string) => void;
}) {
  if (children.length === 0) return null;

  return (
    <T3SurfacePanel tone="inset" className="mt-2 ml-2 rounded-md px-2 py-1.5">
      <div className="space-y-1.5 border-l-2 border-border/70 pl-2">
        {children.map((child) => (
          <TicketWorkItemCard
            key={child.id}
            ticket={child}
            compact
            flat
            child
            onOpen={() => onOpenTicket(projectId, child.id)}
          />
        ))}
      </div>
    </T3SurfacePanel>
  );
}
