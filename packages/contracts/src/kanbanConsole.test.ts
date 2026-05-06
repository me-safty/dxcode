import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  KanbanConsoleGitFileActionRequest,
  KanbanConsoleGitFileDiff,
  KanbanConsoleArtifactContent,
  KanbanConsoleArtifactWriteRequest,
  KanbanConsoleArtifactWriteResult,
  KanbanConsoleSnapshot,
  KanbanConsoleTaskContextPackage,
  KanbanConsoleTaskTransitionRequest,
} from "./kanbanConsole.ts";

const decodeSnapshot = Schema.decodeUnknownSync(KanbanConsoleSnapshot);
const decodeTaskContext = Schema.decodeUnknownSync(KanbanConsoleTaskContextPackage);
const decodeTransitionRequest = Schema.decodeUnknownSync(KanbanConsoleTaskTransitionRequest);
const decodeGitFileActionRequest = Schema.decodeUnknownSync(KanbanConsoleGitFileActionRequest);
const decodeGitFileDiff = Schema.decodeUnknownSync(KanbanConsoleGitFileDiff);
const decodeArtifactContent = Schema.decodeUnknownSync(KanbanConsoleArtifactContent);
const decodeArtifactWriteRequest = Schema.decodeUnknownSync(KanbanConsoleArtifactWriteRequest);
const decodeArtifactWriteResult = Schema.decodeUnknownSync(KanbanConsoleArtifactWriteResult);

describe("kanbanConsole contracts", () => {
  it("decodes a complete mock-runtime snapshot boundary", () => {
    const decoded = decodeSnapshot({
      version: 1,
      generatedAt: "2026-05-06T13:30:00.000Z",
      locale: "en",
      repos: [
        {
          id: "repo-1",
          name: "kanban-console",
          owner: "MohAnghabo",
          path: "/tmp/kanban-console",
          branch: "feature/contracts",
          ahead: 1,
          behind: 0,
          openPrs: 1,
          activeTasks: 2,
          status: "healthy",
        },
      ],
      boards: [
        {
          id: "board-1",
          owner: "MohAnghabo",
          title: "Kanban Project Console",
          source: "github-projects",
          columns: ["backlog", "ready", "in-progress", "review", "blocked", "done"],
        },
      ],
      tasks: [
        {
          id: "task-1",
          issue: "kanban-console#1",
          title: "Contracts",
          titleAr: "العقود",
          repo: "kanban-console",
          column: "ready",
          priority: "P1",
          assignee: "Codex",
          checks: { passing: 1, pending: 0, failing: 0 },
          agent: "Codex",
          agentSessionStatus: "queued",
          updated: "2026-05-06T10:20:00.000Z",
          comments: 0,
        },
      ],
      prWatches: [],
      suggestedFixes: [],
      commandRuns: [],
      gitStatuses: [
        {
          repoId: "repo-1",
          cwd: "/tmp/kanban-console",
          isRepo: true,
          branch: "feature/contracts",
          upstream: "origin/feature/contracts",
          ahead: 1,
          behind: 0,
          aheadOfDefault: 1,
          files: [
            {
              path: "packages/contracts/src/kanbanConsole.ts",
              sourcePath: "packages/contracts/src/kanbanConsole.old.ts",
              status: "staged",
              change: "renamed",
              additions: 12,
              deletions: 2,
              diffAvailable: true,
              hunkStaging: "supported",
            },
            {
              path: "docs/product/new.md",
              status: "untracked",
              change: "added",
              additions: 4,
              deletions: 0,
              diffAvailable: true,
              hunkStaging: "not-applicable",
            },
          ],
          policyViolations: [
            {
              id: "missing-upstream",
              kind: "missing-upstream",
              severity: "warning",
              message: "Branch has no upstream.",
            },
          ],
        },
      ],
      artifacts: [],
      gitOpsPolicy: {
        protectedBranches: ["main"],
        allowedWorkBranchPrefixes: ["feature/"],
        destructiveActionsRequireSecondConfirmation: true,
      },
      releaseReadiness: {
        branch: "release/test",
        latestTag: "v0.1.0",
        targetTag: "v0.2.0",
        gates: [{ id: "gate-1", label: "Validate", status: "pending" }],
      },
      agentWorkflows: [
        {
          id: "codex-phase",
          label: "Codex /phase",
          agent: "Codex",
          command: "/phase t3-kanban-project-console phase-5",
          commandId: "phase",
          available: true,
        },
      ],
      agentSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          workflowId: "codex-phase",
          agent: "Codex",
          command: "/phase t3-kanban-project-console phase-5",
          status: "queued",
          duplicateKey: "task-1:codex-phase:ready",
          duplicateSuppressed: false,
          summary: "Queued Codex workflow.",
          startedAt: "2026-05-06T10:21:00.000Z",
        },
      ],
    });

    expect(decoded).toMatchObject({
      version: 1,
      tasks: [{ id: "task-1", column: "ready" }],
      agentSessions: [{ status: "queued" }],
    });
    expect(decoded.gitStatuses[0]?.files.some((file) => file.hunkStaging === "supported")).toBe(
      true,
    );
    expect(decoded.gitStatuses[0]?.files[0]?.sourcePath).toBe(
      "packages/contracts/src/kanbanConsole.old.ts",
    );
    expect(decoded.releaseReadiness.targetTag).toBe("v0.2.0");
  });

  it("decodes the shared task context package used by agent launchers", () => {
    expect(
      decodeTaskContext({
        task: {
          id: "task-1",
          issue: "kanban-console#43",
          title: "Launch agent workflow",
          repo: "kanban-console",
          column: "ready",
          priority: "P1",
        },
        project: {
          id: "board-1",
          owner: "MohAnghabo",
          title: "Kanban Project Console",
        },
        repo: {
          id: "repo-1",
          owner: "MohAnghabo",
          name: "kanban-console",
          path: "/tmp/kanban-console",
          branch: "feature/agent-launchers",
        },
        issueUrl: "https://github.com/MohAnghabo/kanban-console/issues/43",
        prUrl: "https://github.com/MohAnghabo/kanban-console/pull/7",
        artifacts: [{ path: "docs/tasks/t3-kanban-project-console.md", status: "clean" }],
        validationCommands: ["bun check"],
        governanceRules: ["AGENTS.md", ".ai/rules/22-kanban-console.md"],
      }),
    ).toMatchObject({
      task: { id: "task-1" },
      validationCommands: ["bun check"],
    });
  });

  it("rejects unknown Kanban transition columns", () => {
    expect(() =>
      decodeTransitionRequest({
        taskId: "task-1",
        fromColumn: "ready",
        toColumn: "qa",
        confirmed: false,
      }),
    ).toThrow();
  });

  it("decodes git file actions and diffs for Phase 6", () => {
    expect(
      decodeGitFileActionRequest({
        repoId: "repo-1",
        cwd: "/tmp/kanban-console",
        paths: ["apps/web/src/routes/kanban.tsx"],
        confirmed: true,
      }),
    ).toMatchObject({ paths: ["apps/web/src/routes/kanban.tsx"] });

    expect(
      decodeGitFileDiff({
        repoId: "repo-1",
        path: "apps/web/src/routes/kanban.tsx",
        status: "unstaged",
        diff: "diff --git a/apps/web/src/routes/kanban.tsx b/apps/web/src/routes/kanban.tsx",
        truncated: false,
      }),
    ).toMatchObject({ status: "unstaged", truncated: false });
  });

  it("rejects empty git file action path lists", () => {
    expect(() =>
      decodeGitFileActionRequest({
        repoId: "repo-1",
        cwd: "/tmp/kanban-console",
        paths: [],
        confirmed: true,
      }),
    ).toThrow();
  });

  it("decodes product artifact read and guarded write contracts", () => {
    expect(
      decodeArtifactContent({
        repoId: "repo-1",
        path: "docs/product/project-console.md",
        title: "Project Console",
        status: "clean",
        updatedAt: "2026-05-06T12:00:00.000Z",
        content: "# Project Console\n\nSynthetic product note.",
        preview: "Project Console\nSynthetic product note.",
      }),
    ).toMatchObject({ title: "Project Console", status: "clean" });

    expect(
      decodeArtifactWriteRequest({
        repoId: "repo-1",
        cwd: "/tmp/kanban-console",
        path: "docs/product/project-console.md",
        content: "# Project Console\n",
        confirmed: true,
        linkedRepository: "MohAnghabo/kanban-console",
        linkedIssueNumber: 43,
      }),
    ).toMatchObject({ confirmed: true, linkedIssueNumber: 43 });

    expect(
      decodeArtifactWriteResult({
        repoId: "repo-1",
        path: "docs/product/project-console.md",
        status: "applied",
        message: "Artifact updated.",
        commentTarget: "issue#43",
      }),
    ).toMatchObject({ status: "applied", commentTarget: "issue#43" });
  });
});
