import { afterEach, assert, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AgentWorkflowLauncher from "./AgentWorkflowLauncher.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const execute = vi.fn<GitHubCli.GitHubCliShape["execute"]>();

const layer = AgentWorkflowLauncher.layer.pipe(
  Layer.provide(
    Layer.mock(GitHubCli.GitHubCli)({
      execute,
      listOpenPullRequests: vi.fn(),
      getPullRequest: vi.fn(),
      getRepositoryCloneUrls: vi.fn(),
      createRepository: vi.fn(),
      createPullRequest: vi.fn(),
      getDefaultBranch: vi.fn(),
      checkoutPullRequest: vi.fn(),
    }),
  ),
);

afterEach(() => {
  execute.mockReset();
});

describe("AgentWorkflowLauncher", () => {
  it.effect("lists Claude and Codex recipes for the supported command surface", () =>
    Effect.gen(function* () {
      const launcher = yield* AgentWorkflowLauncher.AgentWorkflowLauncher;
      const recipes = launcher.listRecipes({
        taskName: "t3-kanban-project-console",
        phaseId: "phase-5",
        issueNumber: 43,
        pullRequestNumber: 7,
        claudeAvailable: true,
        codexAvailable: false,
      });

      assert.equal(recipes.length, 24);
      expect(recipes).toContainEqual({
        id: "claude-phase",
        label: "Claude Implement phase",
        agent: "Claude",
        command: "/phase t3-kanban-project-console phase-5",
        commandId: "phase",
        available: true,
      });
      expect(recipes).toContainEqual({
        id: "codex-extract-pr-learnings",
        label: "Codex Extract PR learnings",
        agent: "Codex",
        command: "/extract-pr-learnings 7",
        commandId: "extract-pr-learnings",
        available: false,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("builds the shared task context package without command output", () =>
    Effect.gen(function* () {
      const launcher = yield* AgentWorkflowLauncher.AgentWorkflowLauncher;
      const context = launcher.buildTaskContext({
        task: {
          id: "task-1",
          issue: "kanban-console#43",
          title: "Launch agent workflow",
          titleAr: "Launch agent workflow",
          repo: "kanban-console",
          column: "ready",
          priority: "P1",
          assignee: "Codex",
          checks: { passing: 2, pending: 0, failing: 0 },
          agent: "Codex",
          updated: "2026-05-06T14:00:00.000Z",
          comments: 3,
        },
        board: {
          id: "board-1",
          owner: "MohAnghabo",
          title: "Kanban Project Console",
          source: "github-projects",
          columns: ["backlog", "ready", "in-progress", "review", "blocked", "done"],
        },
        repo: {
          id: "repo-1",
          name: "kanban-console",
          owner: "MohAnghabo",
          path: "/repo",
          branch: "feature/t3-kanban-phase-5-agent-launchers",
          ahead: 1,
          behind: 0,
          openPrs: 1,
          activeTasks: 3,
          status: "healthy",
        },
        issueUrl: "https://github.com/MohAnghabo/kanban-console/issues/43",
        prUrl: "https://github.com/MohAnghabo/kanban-console/pull/7",
        artifacts: [
          {
            id: "artifact-plan",
            repoId: "repo-1",
            path: "docs/tasks/t3-kanban-project-console.md",
            title: "Plan",
            status: "clean",
            updatedAt: "2026-05-06T14:00:00.000Z",
          },
        ],
      });

      assert.deepStrictEqual(context.task, {
        id: "task-1",
        issue: "kanban-console#43",
        title: "Launch agent workflow",
        repo: "kanban-console",
        column: "ready",
        priority: "P1",
      });
      assert.deepStrictEqual(context.validationCommands, ["bun check"]);
      expect(JSON.stringify(context)).not.toContain("stdout");
      expect(JSON.stringify(context)).not.toContain("token");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("requires confirmation before queueing agent workflows", () =>
    Effect.gen(function* () {
      const launcher = yield* AgentWorkflowLauncher.AgentWorkflowLauncher;
      const recipe = launcher.listRecipes({
        taskName: "t3-kanban-project-console",
        phaseId: "phase-5",
        claudeAvailable: true,
        codexAvailable: true,
      })[0];

      if (!recipe) {
        throw new Error("Expected at least one workflow recipe.");
      }

      const error = yield* launcher
        .queueWorkflow({
          recipe,
          context: {
            task: {
              id: "task-1",
              issue: "kanban-console#43",
              title: "Launch agent workflow",
              repo: "kanban-console",
              column: "ready",
              priority: "P1",
            },
            project: { id: "board-1", owner: "MohAnghabo", title: "Kanban Console" },
            repo: {
              id: "repo-1",
              owner: "MohAnghabo",
              name: "kanban-console",
              path: "/repo",
              branch: "feature/agent-launchers",
            },
            issueUrl: "https://github.com/MohAnghabo/kanban-console/issues/43",
            artifacts: [],
            validationCommands: ["bun check"],
            governanceRules: ["AGENTS.md"],
          },
          confirmed: false,
        })
        .pipe(Effect.flip);

      expect(error.detail).toContain("require explicit confirmation");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("suppresses duplicate queued or running workflow sessions", () =>
    Effect.gen(function* () {
      const launcher = yield* AgentWorkflowLauncher.AgentWorkflowLauncher;
      const recipe = launcher
        .listRecipes({
          taskName: "t3-kanban-project-console",
          phaseId: "phase-5",
          claudeAvailable: true,
          codexAvailable: true,
        })
        .find((item) => item.id === "codex-phase");

      if (!recipe) {
        throw new Error("Expected Codex phase workflow recipe.");
      }

      const context = {
        task: {
          id: "task-1",
          issue: "kanban-console#43",
          title: "Launch agent workflow",
          repo: "kanban-console",
          column: "ready" as const,
          priority: "P1" as const,
        },
        project: { id: "board-1", owner: "MohAnghabo", title: "Kanban Console" },
        repo: {
          id: "repo-1",
          owner: "MohAnghabo",
          name: "kanban-console",
          path: "/repo",
          branch: "feature/agent-launchers",
        },
        issueUrl: "https://github.com/MohAnghabo/kanban-console/issues/43",
        artifacts: [],
        validationCommands: ["bun check"],
        governanceRules: ["AGENTS.md"],
      };

      const first = yield* launcher.queueWorkflow({
        recipe,
        context,
        confirmed: true,
        now: new Date("2026-05-06T14:00:00.000Z"),
      });
      const second = yield* launcher.queueWorkflow({
        recipe,
        context,
        confirmed: true,
        activeSessions: [first],
        now: new Date("2026-05-06T14:01:00.000Z"),
      });

      assert.equal(first.status, "queued");
      assert.equal(second.id, first.id);
      assert.equal(second.duplicateSuppressed, true);
      expect(second.summary).toContain("Duplicate agent workflow suppressed");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("posts concise GitHub comments for agent session lifecycle states", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(Effect.succeed(processOutput("https://github.com/comment\n")));

      const launcher = yield* AgentWorkflowLauncher.AgentWorkflowLauncher;
      yield* launcher.postSessionComment({
        cwd: "/repo",
        repository: "MohAnghabo/kanban-console",
        issueNumber: 43,
        event: "started",
        confirmed: true,
        session: {
          id: "agent-session-1",
          taskId: "task-1",
          workflowId: "codex-phase",
          agent: "Codex",
          command: "/phase t3-kanban-project-console phase-5",
          status: "queued",
          duplicateKey: "task-1:codex-phase:ready:feature/agent-launchers",
          duplicateSuppressed: false,
          summary: "Codex workflow queued with a redacted task context package.",
          startedAt: "2026-05-06T14:00:00.000Z",
        },
      });

      const body = execute.mock.calls[0]?.[0].args.at(-1);
      expect(body).toContain("Kanban Console agent workflow started.");
      expect(body).toContain("Raw command output is intentionally omitted.");
      expect(body).not.toContain("stdout");
      expect(execute).toHaveBeenCalledWith({
        cwd: "/repo",
        args: ["issue", "comment", "43", "--repo", "MohAnghabo/kanban-console", "--body", body],
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );
});
