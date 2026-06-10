import { describe, expect, it } from "vite-plus/test";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";

import { resolveProjectThreadsForQuery } from "./t3work-useProjectStoreQueries";
import {
  makeLiveProject,
  makeProjectThread,
  makeStoredProject,
} from "./t3work-threadBridge.testSupport";

describe("resolveProjectThreadsForQuery", () => {
  it("does not show a stored ticket thread again under a loose workspace", () => {
    const storedProjects = [
      makeStoredProject({
        workspace: undefined,
        source: {
          provider: "atlassian",
          externalProjectId: "jira-123",
        },
      }),
    ];
    const localThreads = [
      makeProjectThread({
        id: "thread-1",
        projectId: "stored-project",
        ticketId: "IES-18425",
      }),
    ];
    const liveProjects = [makeLiveProject({ id: ProjectId.make("live-loose") })];
    const liveThreads = [
      {
        id: "thread-1",
        projectId: ProjectId.make("live-loose"),
        title: "IES-18425 kickoff 1",
        messages: [],
        createdAt: "2026-05-22T09:00:00.000Z",
        updatedAt: "2026-05-22T10:00:00.000Z",
        environmentId: "env-local" as EnvironmentId,
        defaultModelSelection: null,
      } as never,
    ];

    expect(
      resolveProjectThreadsForQuery({
        projectId: ProjectId.make("live-loose"),
        projects: storedProjects,
        threads: localThreads,
        liveProjects,
        liveThreads,
      }),
    ).toEqual([]);

    expect(
      resolveProjectThreadsForQuery({
        projectId: "stored-project",
        projects: storedProjects,
        threads: localThreads,
        liveProjects,
        liveThreads,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "thread-1",
        projectId: "stored-project",
        ticketId: "IES-18425",
      }),
    ]);
  });
});
