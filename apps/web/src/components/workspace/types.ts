import type { LucideIcon } from "lucide-react";

/**
 * Stable identifier for a card in the workspace stack. The viewer is
 * intentionally NOT in this union — it's not a stack card, it's the takeover
 * overlay triggered by selecting a file in the tree.
 *
 * Adding a new stack card (e.g. "instructions", "context", "scheduled") is a
 * matter of extending this union and registering a descriptor in
 * `WorkspaceRail`.
 */
export type WorkspacePaneId = "tree" | "recent" | "task";

/**
 * Visibility map for the stack cards. Collapsed-vs-expanded body state is
 * tracked separately (see `useWorkspacePaneCollapsed`).
 */
export interface WorkspacePaneVisibilityMap {
  tree: boolean;
  recent: boolean;
  task: boolean;
}

/**
 * Descriptor the WorkspaceRail uses to render a stack card.
 */
export interface WorkspacePaneDescriptor {
  id: WorkspacePaneId;
  label: string;
  /** Short helper shown in the visibility-menu tooltip. */
  description: string;
  Icon: LucideIcon;
}

/** Render order for the stack cards (top to bottom). */
export const WORKSPACE_PANE_ORDER: ReadonlyArray<WorkspacePaneId> = ["tree", "recent", "task"];
