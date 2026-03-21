import "../index.css";

import { ProjectId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import ProjectNotesSidebar from "./ProjectNotesSidebar";

const PROJECT_ID = ProjectId.makeUnsafe("project-notes-sidebar");

describe("ProjectNotesSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not flush pending notes when it rerenders with a new change callback", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const firstOnNotesChange = vi.fn();
    const screen = await render(
      <ProjectNotesSidebar
        projectId={PROJECT_ID}
        projectName="Notes"
        notes=""
        width={360}
        onNotesChange={firstOnNotesChange}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
      />,
      { container: host },
    );

    try {
      const textarea = page.getByPlaceholder("Jot down ideas, todos, or notes for this project...");
      await textarea.fill("pending notes");

      const secondOnNotesChange = vi.fn();
      await screen.rerender(
        <ProjectNotesSidebar
          projectId={PROJECT_ID}
          projectName="Notes"
          notes=""
          width={360}
          onNotesChange={secondOnNotesChange}
          onWidthChange={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      expect(firstOnNotesChange).not.toHaveBeenCalled();
      expect(secondOnNotesChange).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
