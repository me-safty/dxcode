import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PanelLayoutControls } from "./PanelLayoutControls";

const noop = vi.fn();

describe("PanelLayoutControls", () => {
  it("hides the terminal drawer toggle when terminal panels are unavailable", () => {
    const markup = renderToStaticMarkup(
      <PanelLayoutControls
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel="Mod+J"
        rightPanelAvailable
        rightPanelOpen={false}
        rightPanelShortcutLabel="Mod+Shift+J"
        onToggleTerminal={noop}
        onToggleRightPanel={noop}
      />,
    );

    expect(markup).not.toContain("Toggle terminal drawer");
    expect(markup).toContain("Toggle right panel");
  });

  it("hides all panel toggles when no panel surfaces are available", () => {
    const markup = renderToStaticMarkup(
      <PanelLayoutControls
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel="Mod+J"
        rightPanelAvailable={false}
        rightPanelOpen={false}
        rightPanelShortcutLabel="Mod+Shift+J"
        onToggleTerminal={noop}
        onToggleRightPanel={noop}
      />,
    );

    expect(markup).not.toContain("Toggle terminal drawer");
    expect(markup).not.toContain("Toggle right panel");
    expect(markup).not.toContain("Right panel is unavailable");
  });
});
