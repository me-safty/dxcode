import { describe, expect, it, vi } from "vitest";

import {
  buildT3workSidecarItemMenuEntries,
  buildT3workSidecarSectionHeaderMenuEntries,
} from "~/t3work/t3work-sidecarSectionMenuActions";

const DECLARED_ACTION = {
  id: "apply-now",
  label: "Apply filter now",
  run: {
    kind: "tool" as const,
    toolName: "t3work.backlog.set_assignee_filter",
    input: { mode: "current-user" },
  },
};

describe("sidecar section menu entries", () => {
  it("keeps universal header actions ahead of declared actions in one ordered menu model", () => {
    const entries = buildT3workSidecarSectionHeaderMenuEntries({
      collapsed: false,
      canMoveUp: true,
      canMoveDown: true,
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
      onToggleCollapsed: vi.fn(),
      onHideSection: vi.fn(),
      declaredActions: [DECLARED_ACTION],
      onRunDeclaredAction: vi.fn(),
    });

    expect(entries.map((entry) => (entry.kind === "action" ? entry.label : "separator"))).toEqual([
      "Move up",
      "Move down",
      "Collapse section",
      "Hide section",
      "separator",
      "Apply filter now",
    ]);
  });

  it("keeps universal item actions ahead of declared actions in one ordered menu model", () => {
    const entries = buildT3workSidecarItemMenuEntries({
      pinned: false,
      onPinItem: vi.fn(),
      onUnpinItem: vi.fn(),
      onHideItem: vi.fn(),
      declaredActions: [DECLARED_ACTION],
      onRunDeclaredAction: vi.fn(),
    });

    expect(entries.map((entry) => (entry.kind === "action" ? entry.label : "separator"))).toEqual([
      "Pin item",
      "Hide item",
      "separator",
      "Apply filter now",
    ]);
  });

  it("shows Edit this… only for items with a project-local source path and invokes it", () => {
    const onEditItem = vi.fn();
    const entries = buildT3workSidecarItemMenuEntries({
      pinned: false,
      onPinItem: vi.fn(),
      onUnpinItem: vi.fn(),
      editSourcePath: "/workspace/.t3work/recipes/local/recipe.json",
      onEditItem,
      onHideItem: vi.fn(),
      onRunDeclaredAction: vi.fn(),
    });

    expect(entries.map((entry) => (entry.kind === "action" ? entry.label : "separator"))).toEqual([
      "Pin item",
      "Edit this…",
      "Hide item",
    ]);
    const editEntry = entries.find((entry) => entry.kind === "action" && entry.id === "edit-item");
    expect(editEntry?.kind).toBe("action");
    if (editEntry?.kind === "action") {
      editEntry.onSelect();
    }
    expect(onEditItem).toHaveBeenCalledWith("/workspace/.t3work/recipes/local/recipe.json");
  });

  it("omits Edit this… for items that do not expose a source path", () => {
    const entries = buildT3workSidecarItemMenuEntries({
      pinned: false,
      onPinItem: vi.fn(),
      onUnpinItem: vi.fn(),
      onHideItem: vi.fn(),
      onRunDeclaredAction: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "action" && entry.id === "edit-item")).toBe(
      false,
    );
  });
});
