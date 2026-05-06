import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  KanbanConsoleSnapshot,
  KanbanConsoleTaskContextPackage,
  KanbanConsoleTaskTransitionRequest,
} from "./kanbanConsole.ts";

const decodeSnapshot = Schema.decodeUnknownSync(KanbanConsoleSnapshot);
const decodeTaskContext = Schema.decodeUnknownSync(KanbanConsoleTaskContextPackage);
const decodeTransitionRequest = Schema.decodeUnknownSync(KanbanConsoleTaskTransitionRequest);

describe("kanbanConsole contracts", () => {
  it("decodes a complete mock-runtime snapshot boundary", () => {
    expect(
      decodeSnapshot({
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
        gitStatuses: [],
        artifacts: [],
        gitOpsPolicy: {
          protectedBranches: ["main"],
          allowedWorkBranchPrefixes: ["feature/"],
          destructiveActionsRequireSecondConfirmation: true,
        },
        releaseReadiness: {
          branch: "release/test",
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
      }),
    ).toMatchObject({
      version: 1,
      tasks: [{ id: "task-1", column: "ready" }],
      agentSessions: [{ status: "queued" }],
    });
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
});
