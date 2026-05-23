import { EllipsisIcon, SquarePenIcon } from "lucide-react";

export function ProjectSidebarTicketEntryActions({
  displayId,
  onCreateThread,
  onOpenMenu,
}: {
  displayId: string;
  onCreateThread: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-start opacity-0 transition-opacity duration-150 group-hover/ticket:pointer-events-auto group-hover/ticket:opacity-100">
      <div className="h-full w-6 bg-gradient-to-r from-transparent to-card" />
      <div className="flex items-center gap-1 bg-card pt-1">
        <button
          type="button"
          aria-label={`Create new thread for ${displayId}`}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          onClick={onCreateThread}
        >
          <SquarePenIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Issue actions for ${displayId}`}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          onClick={onOpenMenu}
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
