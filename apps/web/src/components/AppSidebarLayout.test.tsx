import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { AppSidebarLayout } from "./AppSidebarLayout";

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({}),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../keybindings", () => ({
  resolveShortcutCommand: () => null,
  shortcutLabelForCommand: () => null,
}));

vi.mock("../state/server", () => ({
  primaryServerKeybindingsAtom: {},
}));

vi.mock("./Sidebar", () => ({
  default: () => <div data-thread-sidebar="" />,
}));

describe("AppSidebarLayout", () => {
  it("paints the sidebar trigger after titlebar drag surfaces", () => {
    const html = renderToStaticMarkup(
      <AppSidebarLayout>
        <main data-main-content="" />
      </AppSidebarLayout>,
    );

    const mainContentIndex = html.indexOf('data-main-content=""');
    const sidebarControlIndex = html.indexOf('data-sidebar-control=""');

    expect(mainContentIndex).toBeGreaterThan(-1);
    expect(sidebarControlIndex).toBeGreaterThan(mainContentIndex);

    const controlTag = html.slice(
      html.lastIndexOf("<div", sidebarControlIndex),
      html.indexOf(">", sidebarControlIndex),
    );
    expect(controlTag).toContain("pointer-events-none");
    expect(controlTag).not.toContain("-webkit-app-region:no-drag");
  });
});
