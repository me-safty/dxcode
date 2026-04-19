import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { memo } from "react";
import { type DraftId } from "~/composerDraftStore";
import { BriefcaseBusinessIcon, FolderKanbanIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  showWorkspaceToggle?: boolean;
  workspacePanelOpen?: boolean;
  onToggleWorkspacePanel?: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadTitle,
  activeProjectName,
  showWorkspaceToggle = false,
  workspacePanelOpen = false,
  onToggleWorkspacePanel,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/58">
            Active task
          </p>
          <h2
            className="min-w-0 shrink truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
        </div>
        {activeProjectName && (
          <Badge
            variant="outline"
            className="min-w-0 shrink overflow-hidden rounded-full border-border/60 bg-card/70 px-2.5"
          >
            <BriefcaseBusinessIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
      </div>
      {showWorkspaceToggle && onToggleWorkspacePanel ? (
        <div className="no-drag shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleWorkspacePanel}
            aria-label={workspacePanelOpen ? "Hide console panel" : "Show console panel"}
            title={workspacePanelOpen ? "Hide console panel" : "Show console panel"}
            className={
              workspacePanelOpen
                ? "rounded-full border border-blue-200/80 bg-blue-500/10 px-3 text-blue-600 hover:bg-blue-500/14 dark:border-blue-400/30 dark:text-blue-300"
                : "rounded-full border border-border/70 bg-background/75 px-3 text-foreground/74 hover:bg-accent/60"
            }
          >
            <FolderKanbanIcon className="size-3.5" />
            Console
          </Button>
        </div>
      ) : null}
    </div>
  );
});
