import "../t3work-index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "~/localApi";
import { type T3WorkSidebarNavPreferences } from "~/t3work/t3work-sidebarNavPreferences";
import { buildTicketSidebarPinnedItemId } from "~/t3work/t3work-sidebarPinningTypes";
import { useT3WorkSidebarNavPreferencesStore } from "~/t3work/t3work-sidebarNavPreferencesStore";
import {
  JiraTicketEntryHarness,
  createNativeApiMock,
  findDraggableRow,
  project,
  readRowOrder,
} from "./t3work-ProjectSidebarTicketEntry.browserSupport";

vi.mock("~/t3work/hooks/t3work-useAddToChat", () => ({
  useAddToChat: () => ({
    addToChatFromRequest: vi.fn(async () => undefined),
  }),
}));

afterEach(async () => {
  document.body.innerHTML = "";
  delete window.nativeApi;
  localStorage.clear();
  useT3WorkSidebarNavPreferencesStore.setState({ hydrated: true, preferencesByProjectId: {} });
  await __resetLocalApiForTests();
});

describe("ProjectSidebarTicketEntry browser", () => {
  it("shows an Unpin action for Jira work items rendered in the left nav", async () => {
    const showContextMenu = vi.fn(async () => null);
    await __resetLocalApiForTests();
    window.nativeApi = createNativeApiMock({ showContextMenu });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<JiraTicketEntryHarness />, { container: host });

    try {
      const row = findDraggableRow(host, "PROJ-9");
      expect(row).toBeTruthy();
      const actionsButton = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Issue actions for PROJ-9"]',
      );
      expect(actionsButton).toBeTruthy();
      actionsButton!.click();

      await vi.waitFor(() => {
        expect(showContextMenu).toHaveBeenCalledTimes(1);
      });
      const firstCall = showContextMenu.mock.calls.at(0) as
        | [ReadonlyArray<{ id: string; label: string }>]
        | undefined;
      expect(firstCall?.[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "add-to-chat", label: "Add to chat" }),
          expect.objectContaining({ id: "unpin", label: "Unpin" }),
        ]),
      );
      expect(row?.draggable).toBe(true);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders Jira work items in stored order and persists sidebar order updates", async () => {
    const setClientSettings = vi.fn(async () => undefined);
    await __resetLocalApiForTests();
    window.nativeApi = createNativeApiMock({ setClientSettings });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<JiraTicketEntryHarness />, { container: host });

    try {
      expect(readRowOrder(host)).toEqual(["PROJ-9", "PROJ-10"]);

      useT3WorkSidebarNavPreferencesStore
        .getState()
        .setOrderedItemIds(project.id, [
          buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: "ticket-2" }),
          buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: "ticket-1" }),
        ]);

      await vi.waitFor(() => {
        expect(readRowOrder(host)).toEqual(["PROJ-10", "PROJ-9"]);
      });
      await vi.waitFor(() => {
        expect(setClientSettings).toHaveBeenCalled();
      });

      const lastCall = setClientSettings.mock.calls.at(-1) as [Record<string, unknown>] | undefined;
      const savedPreferences = JSON.parse(
        typeof lastCall?.[0]?.t3workStoredSidebarNavPreferencesJson === "string"
          ? lastCall[0].t3workStoredSidebarNavPreferencesJson
          : "{}",
      ) as T3WorkSidebarNavPreferences;
      expect(savedPreferences[project.id]?.orderedItemIds).toEqual([
        buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: "ticket-2" }),
        buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: "ticket-1" }),
      ]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
