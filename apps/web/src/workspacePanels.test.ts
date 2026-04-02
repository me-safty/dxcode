import { describe, expect, it } from "vitest";

import { resolveActiveRightRailPanel, resolveWorkspacePanels } from "./workspacePanels";

describe("resolveActiveRightRailPanel", () => {
  it("prefers diff when both diff and terminal are open on the right", () => {
    expect(
      resolveActiveRightRailPanel({
        terminalPosition: "right",
        diffOpen: true,
        terminalOpen: true,
      }),
    ).toBe("diff");
  });

  it("falls back to the terminal when diff is closed", () => {
    expect(
      resolveActiveRightRailPanel({
        terminalPosition: "right",
        diffOpen: false,
        terminalOpen: true,
      }),
    ).toBe("terminal");
  });
});

describe("resolveWorkspacePanels", () => {
  it("does not show the inline diff rail when diff is closed in bottom mode", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "bottom",
        terminalBottomScope: "chat",
        shouldUseDiffSheet: false,
        diffOpen: false,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: false,
      rightRailPanel: null,
      showDiffSheet: false,
      showInlineDiffRail: false,
      showTerminalSheet: false,
      supportsInlineDiffRail: true,
      terminalDockTarget: "bottom-inline",
      terminalToggleActive: true,
    });
  });

  it("keeps a chat-scoped bottom terminal inline and leaves diff independent", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "bottom",
        terminalBottomScope: "chat",
        shouldUseDiffSheet: false,
        diffOpen: true,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: true,
      rightRailPanel: null,
      showDiffSheet: false,
      showInlineDiffRail: true,
      showTerminalSheet: false,
      supportsInlineDiffRail: true,
      terminalDockTarget: "bottom-inline",
      terminalToggleActive: true,
    });
  });

  it("uses the workspace bottom slot when the bottom terminal should span the full workspace", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "bottom",
        terminalBottomScope: "workspace",
        shouldUseDiffSheet: false,
        diffOpen: false,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: false,
      rightRailPanel: null,
      showDiffSheet: false,
      showInlineDiffRail: false,
      showTerminalSheet: false,
      supportsInlineDiffRail: true,
      terminalDockTarget: "bottom-workspace",
      terminalToggleActive: true,
    });
  });

  it("uses the shared right rail when the terminal is positioned on the right", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "right",
        terminalBottomScope: "chat",
        shouldUseDiffSheet: false,
        diffOpen: true,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: true,
      rightRailPanel: "diff",
      showDiffSheet: false,
      showInlineDiffRail: false,
      showTerminalSheet: false,
      supportsInlineDiffRail: false,
      terminalDockTarget: "right",
      terminalToggleActive: false,
    });
  });

  it("falls back to the diff sheet on narrow right layouts and preserves terminal docking state", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "right",
        terminalBottomScope: "chat",
        shouldUseDiffSheet: true,
        diffOpen: true,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: true,
      rightRailPanel: null,
      showDiffSheet: true,
      showInlineDiffRail: false,
      showTerminalSheet: false,
      supportsInlineDiffRail: false,
      terminalDockTarget: "right",
      terminalToggleActive: false,
    });
  });

  it("falls back to a terminal sheet on narrow right layouts when diff is closed", () => {
    expect(
      resolveWorkspacePanels({
        terminalPosition: "right",
        terminalBottomScope: "chat",
        shouldUseDiffSheet: true,
        diffOpen: false,
        terminalOpen: true,
      }),
    ).toEqual({
      diffToggleActive: false,
      rightRailPanel: null,
      showDiffSheet: false,
      showInlineDiffRail: false,
      showTerminalSheet: true,
      supportsInlineDiffRail: false,
      terminalDockTarget: "right",
      terminalToggleActive: true,
    });
  });
});
