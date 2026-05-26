import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarMenuSubButton } from "~/t3work/components/ui/t3work-sidebar";
import { GitHubActivityInlineList } from "~/t3work/t3work-GitHubActivityViews";
import {
  T3WorkAgentContextDropOverlay,
  useT3WorkAgentContextDropTarget,
} from "~/t3work/t3work-agentContextDrag";
import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import { useT3WorkSidebarNavPreferencesStore } from "~/t3work/t3work-sidebarNavPreferencesStore";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import {
  getSidebarStandaloneButtonClassName,
  type SidebarItemState,
} from "./t3work-projectSidebarItemState";

type ProjectSidebarDashboardNavProps = {
  backlogState: SidebarItemState;
  myWorkState: SidebarItemState;
  myWorkExpanded: boolean;
  myWorkThreadCount: number;
  pinnedItemCount?: number;
  onMyWorkExpandedChange: (expanded: boolean) => void;
  onSelectBacklog: () => void;
  onSelectMyWork: () => void;
  backlogContent?: ReactNode;
  pinnedContent?: ReactNode;
  myWorkContent?: ReactNode;
  showJiraItems: boolean;
  currentIssueCount: number;
  currentIssuesContent: ReactNode;
  showGitHubActivity: boolean;
  githubItems: ReadonlyArray<GitHubWorkActivityItem>;
  githubActivityLastCheckedAt?: number;
};

export function ProjectSidebarDashboardNav({
  backlogState,
  myWorkState,
  myWorkExpanded,
  myWorkThreadCount,
  pinnedItemCount = 0,
  onMyWorkExpandedChange,
  onSelectBacklog,
  onSelectMyWork,
  backlogContent,
  pinnedContent,
  myWorkContent,
  showJiraItems,
  currentIssueCount,
  currentIssuesContent,
  showGitHubActivity,
  githubItems,
  githubActivityLastCheckedAt,
}: ProjectSidebarDashboardNavProps) {
  const pinItem = useT3WorkPinnedSidebarStore((state) => state.pinItem);
  const showSidebarItem = useT3WorkSidebarNavPreferencesStore((state) => state.showItem);
  const { isActive: isPinDropActive, dropProps } = useT3WorkAgentContextDropTarget({
    canDrop: (record) =>
      record.capabilities.actions.some((action) => action.kind === "pin-to-sidebar"),
    onDropRecord: (record) => {
      const action = record.capabilities.actions.find(
        (candidate) => candidate.kind === "pin-to-sidebar",
      );
      if (action?.kind !== "pin-to-sidebar") {
        return;
      }

      pinItem(action.item);
      showSidebarItem(action.item.projectId, action.item.id);
    },
    dropEffect: "move",
    onDropped: () => onMyWorkExpandedChange(true),
  });
  const showCurrentIssuesSection = showJiraItems && currentIssueCount > 0;
  const showGitHubSection = showGitHubActivity && githubItems.length > 0;
  const hasMyWorkChildren =
    pinnedItemCount > 0 || myWorkThreadCount > 0 || showCurrentIssuesSection || showGitHubSection;
  const showMyWorkSection = myWorkExpanded && hasMyWorkChildren;

  return (
    <>
      <div className="mx-1 mt-1 mb-1.5 flex w-full flex-col gap-0.5 overflow-hidden px-1.5 py-0.5">
        <div className="w-full">
          <SidebarMenuSubButton
            size="sm"
            isActive={backlogState.isSelected}
            className={`h-7 w-full translate-x-0 justify-start px-2 text-left text-[11px] ${getSidebarStandaloneButtonClassName(
              backlogState,
            )}`}
            onClick={onSelectBacklog}
          >
            <span className="truncate">Backlog</span>
          </SidebarMenuSubButton>
        </div>

        {backlogContent}

        <div className="relative w-full" {...dropProps}>
          <SidebarMenuSubButton
            size="sm"
            isActive={myWorkState.isSelected}
            className={`h-7 w-full translate-x-0 justify-start px-2 pr-7 text-left text-[11px] ${getSidebarStandaloneButtonClassName(
              myWorkState,
            )}`}
            onClick={onSelectMyWork}
          >
            <span className="truncate">My work</span>
          </SidebarMenuSubButton>
          <T3WorkAgentContextDropOverlay
            active={isPinDropActive}
            label="Drop to pin this item in My work"
            className="rounded-md"
          />
          {hasMyWorkChildren ? (
            <button
              type="button"
              aria-label={myWorkExpanded ? "Collapse my work" : "Expand my work"}
              className="absolute top-1/2 right-1 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onMyWorkExpandedChange(!myWorkExpanded);
              }}
            >
              <ChevronRightIcon
                className={`size-3.5 transition-transform duration-150 ${myWorkExpanded ? "rotate-90" : ""}`}
              />
            </button>
          ) : null}
        </div>
      </div>

      {showMyWorkSection ? (
        <div className="space-y-2">
          {pinnedContent}

          {myWorkContent}

          {showCurrentIssuesSection ? currentIssuesContent : null}

          {showGitHubSection ? (
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
                GitHub items
              </div>
              <div className="-ml-1">
                <GitHubActivityInlineList
                  items={githubItems}
                  limit={3}
                  compact
                  {...(githubActivityLastCheckedAt !== undefined
                    ? { lastCheckedAt: githubActivityLastCheckedAt }
                    : {})}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
