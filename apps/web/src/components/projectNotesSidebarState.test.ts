import { describe, expect, it } from "vitest";

import { shouldSyncProjectNotesInput } from "./projectNotesSidebarState";

describe("shouldSyncProjectNotesInput", () => {
  it("always syncs when the active project changes", () => {
    expect(
      shouldSyncProjectNotesInput({
        projectChanged: true,
        isTextareaFocused: true,
        hasPendingLocalChange: true,
      }),
    ).toBe(true);
  });

  it("syncs when the textarea is not focused", () => {
    expect(
      shouldSyncProjectNotesInput({
        projectChanged: false,
        isTextareaFocused: false,
        hasPendingLocalChange: true,
      }),
    ).toBe(true);
  });

  it("keeps local notes while a focused textarea has a pending local edit", () => {
    expect(
      shouldSyncProjectNotesInput({
        projectChanged: false,
        isTextareaFocused: true,
        hasPendingLocalChange: true,
      }),
    ).toBe(false);
  });

  it("allows focused syncs after pending local edits are flushed", () => {
    expect(
      shouldSyncProjectNotesInput({
        projectChanged: false,
        isTextareaFocused: true,
        hasPendingLocalChange: false,
      }),
    ).toBe(true);
  });
});
