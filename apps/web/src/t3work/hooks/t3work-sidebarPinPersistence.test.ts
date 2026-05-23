import { describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import { readStoredSidebarPinsFromClientSettings } from "~/t3work/hooks/t3work-sidebarPinPersistence";
import {
  buildGitHubActivitySidebarPinnedItem,
  buildTicketSidebarPinnedItem,
} from "~/t3work/t3work-sidebarPinningTypes";

describe("sidebar pin persistence", () => {
  it("reads persisted sidebar pins from client settings", () => {
    const jiraPin = buildTicketSidebarPinnedItem({
      projectId: "project-1",
      ticketId: "ticket-9",
      pinnedAt: "2026-05-23T12:00:00.000Z",
    });
    const githubPin = buildGitHubActivitySidebarPinnedItem({
      projectId: "project-1",
      activityId: "activity-1",
      pinnedAt: "2026-05-23T11:59:00.000Z",
    });

    expect(
      readStoredSidebarPinsFromClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        t3workStoredSidebarPinsJson: JSON.stringify([jiraPin, githubPin]),
      }),
    ).toEqual([jiraPin, githubPin]);
  });

  it("dedupes persisted sidebar pins by id and keeps the latest payload", () => {
    const original = buildTicketSidebarPinnedItem({
      projectId: "project-1",
      ticketId: "ticket-9",
      pinnedAt: "2026-05-23T11:00:00.000Z",
    });
    const replacement = buildTicketSidebarPinnedItem({
      projectId: "project-1",
      ticketId: "ticket-9",
      pinnedAt: "2026-05-23T12:00:00.000Z",
    });

    expect(
      readStoredSidebarPinsFromClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        t3workStoredSidebarPinsJson: JSON.stringify([original, replacement]),
      }),
    ).toEqual([replacement]);
  });
});
