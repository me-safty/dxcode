import type { MouseEvent } from "react";

import { GitHubActivityInlineList } from "~/t3work/t3work-GitHubActivityViews";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";

export function ProjectSidebarTicketEntryGitHubActivity({
  items,
  lastCheckedAt,
  showGitHubActivity,
  onItemContextMenu,
  getItemDragCapabilities,
}: {
  items: ReadonlyArray<GitHubWorkActivityItem>;
  lastCheckedAt?: number;
  showGitHubActivity: boolean;
  onItemContextMenu: (event: MouseEvent, item: GitHubWorkActivityItem) => void;
  getItemDragCapabilities: (item: GitHubWorkActivityItem) => AgentContextCapabilities;
}) {
  if (!showGitHubActivity || items.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5">
      <GitHubActivityInlineList
        items={items}
        limit={2}
        compact
        {...(lastCheckedAt !== undefined ? { lastCheckedAt } : {})}
        onItemContextMenu={onItemContextMenu}
        getItemDragCapabilities={getItemDragCapabilities}
      />
    </div>
  );
}
