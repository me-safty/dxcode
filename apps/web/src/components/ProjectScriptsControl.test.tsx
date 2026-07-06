import type { ProjectScript, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import ProjectScriptsControl from "./ProjectScriptsControl";

const keybindings: ResolvedKeybindingsConfig = [];

const scripts: ProjectScript[] = [
  {
    id: "build",
    name: "Build",
    command: "pnpm build",
    icon: "build",
    runOnWorktreeCreate: false,
  },
];

function renderProjectScriptsControl(runAvailable: boolean) {
  return renderToStaticMarkup(
    <ProjectScriptsControl
      scripts={scripts}
      keybindings={keybindings}
      runAvailable={runAvailable}
      runUnavailableReason="Project host is disconnected."
      onRunScript={vi.fn()}
      onAddScript={vi.fn()}
      onUpdateScript={vi.fn()}
      onDeleteScript={vi.fn()}
    />,
  );
}

function primaryRunButtonTag(markup: string): string {
  const match = markup.match(/<button[^>]*aria-label="Run Build"[^>]*>/);
  if (!match) {
    throw new Error("Primary run button was not rendered.");
  }
  return match[0];
}

describe("ProjectScriptsControl", () => {
  it("keeps the unavailable primary run action tooltip-triggerable", () => {
    const markup = renderProjectScriptsControl(false);
    const runButton = primaryRunButtonTag(markup);

    expect(runButton).toContain('aria-label="Run Build"');
    expect(runButton).toContain('aria-disabled="true"');
    expect(runButton).toContain("cursor-not-allowed");
    expect(runButton).not.toContain(' disabled=""');
  });

  it("does not mark the primary run action unavailable when running is available", () => {
    const markup = renderProjectScriptsControl(true);
    const runButton = primaryRunButtonTag(markup);

    expect(runButton).toContain('aria-label="Run Build"');
    expect(runButton).toContain('aria-disabled="false"');
    expect(runButton).not.toContain("cursor-not-allowed");
    expect(runButton).not.toContain(' disabled=""');
  });
});
