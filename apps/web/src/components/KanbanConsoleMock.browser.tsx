import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { SidebarProvider } from "./ui/sidebar";
import { KanbanConsoleMock } from "./KanbanConsoleMock";

describe("KanbanConsoleMock", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders the mock board and toggles Arabic RTL mode", async () => {
    const screen = await render(
      <SidebarProvider defaultOpen={false}>
        <KanbanConsoleMock />
      </SidebarProvider>,
    );

    try {
      await expect
        .element(page.getByRole("heading", { name: "Kanban Project Console" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("heading", { exact: true, name: "GitHub Projects board" }))
        .toBeInTheDocument();

      const views = [
        ["Git", "Lazygit-style git status"],
        ["Artifacts", "Product artifacts"],
        ["PRs", "PR watcher"],
        ["Timeline", "Issue and PR timeline"],
        ["CLI", "CLI command console"],
        ["GitOps", "GitOps and release dashboard"],
        ["Settings", "Console settings"],
        ["States", "State previews"],
      ] as const;

      for (const [buttonName, headingName] of views) {
        await page.getByRole("button", { exact: true, name: buttonName }).click();
        await expect
          .element(page.getByRole("heading", { exact: true, name: headingName }))
          .toBeInTheDocument();
      }

      await page.getByRole("button", { exact: true, name: "Artifacts" }).click();
      await page.getByRole("button", { name: /docs\/product\/project-console\.md/u }).click();
      await page.getByLabelText("Artifact markdown editor").fill("# Product artifact\n\nUpdated.");
      await page.getByRole("button", { exact: true, name: "Apply guarded patch" }).click();
      await expect
        .element(page.getByText("Clean artifact is ready for guarded patch flow."))
        .toBeInTheDocument();

      await page.getByRole("button", { exact: true, name: "AR" }).click();

      await expect
        .element(page.getByRole("heading", { name: "وحدة تحكم مشروع كانبان" }))
        .toBeInTheDocument();
      expect(document.querySelector("[dir='rtl']")).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });
});
