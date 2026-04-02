import type { TerminalBottomScope, TerminalPosition } from "@t3tools/contracts/settings";

export type RightRailPanel = "diff" | "terminal" | null;

export const WORKSPACE_PANEL_STORAGE_KEYS = {
  diffRight: "chat_diff_sidebar_width",
  sharedRight: "chat_shared_right_sidebar_width",
  terminalRight: "chat_terminal_right_sidebar_width",
} as const;

export type TerminalDockTarget = "bottom-inline" | "bottom-workspace" | "right" | null;

export function resolveActiveRightRailPanel(input: {
  terminalPosition: TerminalPosition;
  diffOpen: boolean;
  terminalOpen: boolean;
}): RightRailPanel {
  if (input.terminalPosition !== "right") {
    return null;
  }

  if (input.diffOpen) {
    return "diff";
  }

  if (input.terminalOpen) {
    return "terminal";
  }

  return null;
}

export function resolveWorkspacePanels(input: {
  terminalPosition: TerminalPosition;
  terminalBottomScope: TerminalBottomScope;
  shouldUseDiffSheet: boolean;
  diffOpen: boolean;
  terminalOpen: boolean;
}): {
  diffToggleActive: boolean;
  rightRailPanel: RightRailPanel;
  showDiffSheet: boolean;
  showInlineDiffRail: boolean;
  showTerminalSheet: boolean;
  supportsInlineDiffRail: boolean;
  terminalDockTarget: TerminalDockTarget;
  terminalToggleActive: boolean;
} {
  const visibleRightTool = resolveActiveRightRailPanel({
    terminalPosition: input.terminalPosition,
    diffOpen: input.diffOpen,
    terminalOpen: input.terminalOpen,
  });
  const supportsInlineDiffRail = !input.shouldUseDiffSheet && input.terminalPosition !== "right";
  const rightRailPanel = input.shouldUseDiffSheet ? null : visibleRightTool;

  const terminalDockTarget: TerminalDockTarget = !input.terminalOpen
    ? null
    : input.terminalPosition === "bottom"
      ? input.terminalBottomScope === "workspace"
        ? "bottom-workspace"
        : "bottom-inline"
      : input.terminalPosition;

  return {
    diffToggleActive:
      input.terminalPosition === "right" ? visibleRightTool === "diff" : input.diffOpen,
    rightRailPanel,
    showDiffSheet: input.shouldUseDiffSheet && visibleRightTool === "diff",
    showInlineDiffRail: input.diffOpen && supportsInlineDiffRail,
    showTerminalSheet: input.shouldUseDiffSheet && visibleRightTool === "terminal",
    supportsInlineDiffRail,
    terminalDockTarget,
    terminalToggleActive:
      input.terminalPosition === "right" ? visibleRightTool === "terminal" : input.terminalOpen,
  };
}
