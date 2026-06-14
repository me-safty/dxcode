import { describe, expect, it, vi } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RightPanelTabs } from "./RightPanelTabs";

describe("RightPanelTabs", () => {
  it("disables the terminal action when terminals are unavailable", () => {
    const markup = renderToStaticMarkup(
      <RightPanelTabs
        mode="embedded"
        surfaces={[]}
        activeSurfaceId={null}
        previewSessions={{}}
        terminalLabelsById={new Map()}
        onActivate={vi.fn()}
        onCloseSurface={vi.fn()}
        onAddBrowser={vi.fn()}
        onAddTerminal={vi.fn()}
        onAddDiff={vi.fn()}
        onAddSourceControl={vi.fn()}
        browserAvailable
        terminalAvailable={false}
        diffAvailable
        sourceControlAvailable
      >
        <div />
      </RightPanelTabs>,
    );

    expect(markup).toContain("Browser");
    expect(markup).toContain("Diff");
    expect(markup).toContain("Terminal");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Terminal/);
  });
});
