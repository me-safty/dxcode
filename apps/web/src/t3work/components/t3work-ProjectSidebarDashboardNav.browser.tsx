import "../t3work-index.css";

import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ProjectSidebarDashboardNav } from "./t3work-ProjectSidebarDashboardNav";

const inactiveState = { isSelected: false, isOpen: false };

afterEach(() => {
  document.body.innerHTML = "";
});

async function renderNav(
  overrides: Partial<React.ComponentProps<typeof ProjectSidebarDashboardNav>> = {},
) {
  const host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);

  return {
    host,
    screen: await render(
      <ProjectSidebarDashboardNav
        backlogState={inactiveState}
        myWorkState={inactiveState}
        myWorkExpanded
        myWorkThreadCount={0}
        onMyWorkExpandedChange={() => {}}
        onSelectBacklog={() => {}}
        onSelectMyWork={() => {}}
        backlogContent={undefined}
        myWorkContent={undefined}
        showJiraItems={false}
        currentIssueCount={0}
        currentIssuesContent={<div data-testid="current-issues">Current issues</div>}
        showGitHubActivity={false}
        githubItems={[]}
        {...overrides}
      />,
      { container: host },
    ),
  };
}

describe("ProjectSidebarDashboardNav browser", () => {
  it("does not render a chevron or section body when My Work has no children", async () => {
    const { host, screen } = await renderNav({
      myWorkContent: <div data-testid="my-work-threads">My work threads</div>,
    });

    try {
      expect(host.querySelector('button[aria-label="Expand my work"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Collapse my work"]')).toBeNull();
      expect(host.querySelector('[data-testid="my-work-threads"]')).toBeNull();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders the chevron when Jira items keep My Work populated", async () => {
    const { host, screen } = await renderNav({
      showJiraItems: true,
      currentIssueCount: 1,
    });

    try {
      expect(host.querySelector('button[aria-label="Collapse my work"]')).toBeTruthy();
      expect(host.querySelector('[data-testid="current-issues"]')).toBeTruthy();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
