import { describe, expect, it } from "vitest";
import type { ProjectShellProject } from "@t3tools/project-context";

import { buildGitHubActivityContextBundle } from "~/t3work/t3work-githubActivityContextPayload";
import { buildJiraTicketEntryPoint } from "~/t3work/t3work-contextCachePaths";
import type { T3WorkDirectoryBundlePayload } from "~/t3work/t3work-contextDirectoryBundle";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectTicket } from "~/t3work/t3work-types";

function createProject(): ProjectShellProject {
  return {
    id: "Project Alpha" as ProjectShellProject["id"],
    title: "Project Alpha",
    source: {
      provider: "atlassian",
      accountId: "acct-1",
      externalProjectId: "proj-1",
      externalProjectKey: "PROJ",
    },
    workspace: {
      rootPath: "/tmp/project-alpha",
      createdAt: "2026-05-18T00:00:00.000Z",
    },
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function createTicket(): ProjectTicket {
  return {
    id: "proj-7",
    projectId: "Project Alpha",
    ref: {
      provider: "atlassian",
      kind: "issue",
      id: "PROJ-7",
      displayId: "PROJ-7",
      title: "Investigate context sync",
      type: "Bug",
      url: "https://example.test/browse/PROJ-7",
      projectId: "PROJ",
    },
    issueType: "Bug",
    status: "In Progress",
    updatedAt: "2026-05-18T12:00:00.000Z",
  };
}

function createActivity(): GitHubWorkActivityItem {
  return {
    id: "pr-42",
    repository: "example/project-alpha",
    repositoryUrl: "https://github.com/example/project-alpha",
    reason: "review_requested",
    subjectType: "PullRequest",
    subjectTitle: "Fix context sync",
    subjectState: "open",
    authorLogin: "pj",
  };
}

describe("buildGitHubActivityContextBundle", () => {
  it("includes linked ticket entrypoints and merges linked ticket files", () => {
    const project = createProject();
    const ticket = createTicket();
    const linkedTicketEntryPoint = buildJiraTicketEntryPoint(project.id, ticket.ref.displayId);
    const linkedTicketBundle: T3WorkDirectoryBundlePayload = {
      kind: "t3work-directory-bundle",
      dedupeKey: `${project.id}:${ticket.ref.displayId}:work-item`,
      bundleRootRelativePath: ".t3work/context-cache/jira/project-alpha/items/proj-7",
      files: [{ relativePath: linkedTicketEntryPoint, contents: '{"kind":"jira-work-item"}' }],
      fileReferences: [{ label: "Ticket entrypoint", relativePath: linkedTicketEntryPoint }],
      lightweightItem: { kind: "jira-work-item", label: ticket.ref.title },
    };

    const bundle = buildGitHubActivityContextBundle({
      project,
      item: createActivity(),
      linkedWorkItem: ticket,
      linkedTicketBundle,
    });

    expect(bundle.fileReferences).toEqual([
      {
        label: "Activity entrypoint",
        relativePath:
          ".t3work/context-cache/github/project-alpha/example-project-alpha/pr-42/entrypoint.json",
      },
      { label: "Linked ticket entrypoint", relativePath: linkedTicketEntryPoint },
    ]);
    expect(bundle.files.some((file) => file.relativePath === linkedTicketEntryPoint)).toBe(true);

    const entryPoint = bundle.files.find(
      (file) =>
        file.relativePath ===
        ".t3work/context-cache/github/project-alpha/example-project-alpha/pr-42/entrypoint.json",
    );
    expect(JSON.parse(entryPoint?.contents ?? "{}")).toMatchObject({
      kind: "github-activity-pr-open",
      paths: {
        linkedWorkItem:
          ".t3work/context-cache/github/project-alpha/example-project-alpha/pr-42/linked-work-item/context.json",
      },
    });
  });
});
