import { describe, expect, it } from "vitest";

import {
  filterHiddenSidebarItems,
  reorderSidebarItemsInScope,
  sortSidebarItemsByStoredOrder,
} from "~/t3work/t3work-sidebarNavPreferences";

describe("sidebar nav preferences helpers", () => {
  it("filters hidden sidebar items by id", () => {
    expect(
      filterHiddenSidebarItems(
        [{ id: "ticket-1" }, { id: "ticket-2" }, { id: "ticket-3" }],
        ["ticket-2"],
      ),
    ).toEqual([{ id: "ticket-1" }, { id: "ticket-3" }]);
  });

  it("sorts sidebar items by the stored manual order before leaving the rest in place", () => {
    expect(
      sortSidebarItemsByStoredOrder(
        [{ id: "ticket-3" }, { id: "ticket-1" }, { id: "ticket-2" }],
        ["ticket-2", "ticket-1"],
      ),
    ).toEqual([{ id: "ticket-2" }, { id: "ticket-1" }, { id: "ticket-3" }]);
  });

  it("reorders items within a visible scope and preserves unrelated stored ids", () => {
    expect(
      reorderSidebarItemsInScope({
        orderedItemIds: ["ticket-4", "ticket-2", "ticket-1"],
        scopeItemIds: ["ticket-1", "ticket-2", "ticket-3"],
        sourceItemId: "ticket-3",
        targetItemId: "ticket-2",
      }),
    ).toEqual(["ticket-3", "ticket-2", "ticket-1", "ticket-4"]);
  });
});
