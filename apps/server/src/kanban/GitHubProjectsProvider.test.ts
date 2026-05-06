import { afterEach, assert, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubProjectsProvider from "./GitHubProjectsProvider.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const execute = vi.fn<GitHubCli.GitHubCliShape["execute"]>();

const layer = GitHubProjectsProvider.layer.pipe(
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

describe("GitHubProjectsProvider", () => {
  it.effect("checks gh auth readiness without exposing raw command output", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(Effect.succeed(processOutput("github.com\n")));

      const provider = yield* GitHubProjectsProvider.GitHubProjectsProvider;
      const result = yield* provider.checkAuthReadiness({ cwd: "/repo" });

      assert.deepStrictEqual(result, {
        status: "authenticated",
        detail: "GitHub CLI is authenticated.",
      });
      expect(execute).toHaveBeenCalledWith({
        cwd: "/repo",
        args: ["auth", "status"],
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads organization Projects and fields from gh project JSON", () =>
    Effect.gen(function* () {
      execute
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              JSON.stringify({
                projects: [
                  {
                    id: "PVT_kwDOExample",
                    number: 7,
                    title: "Kanban Console",
                    url: "https://github.com/orgs/MohAnghabo/projects/7",
                  },
                ],
              }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              JSON.stringify({
                fields: [
                  {
                    id: "PVTSSF_status",
                    name: "Status",
                    type: "single_select",
                    options: [
                      { id: "opt_ready", name: "Ready" },
                      { id: "opt_progress", name: "In progress" },
                    ],
                  },
                  { id: "PVTF_priority", name: "Priority", type: "text" },
                ],
              }),
            ),
          ),
        );

      const provider = yield* GitHubProjectsProvider.GitHubProjectsProvider;
      const projects = yield* provider.listProjects({
        cwd: "/repo",
        owner: "MohAnghabo",
        limit: 10,
      });
      const fields = yield* provider.listProjectFields({
        cwd: "/repo",
        owner: "MohAnghabo",
        projectNumber: 7,
      });

      assert.deepStrictEqual(projects, [
        {
          id: "PVT_kwDOExample",
          number: 7,
          title: "Kanban Console",
          url: "https://github.com/orgs/MohAnghabo/projects/7",
          closed: false,
        },
      ]);
      assert.deepStrictEqual(fields, [
        {
          id: "PVTSSF_status",
          name: "Status",
          type: "single_select",
          options: [
            { id: "opt_ready", name: "Ready" },
            { id: "opt_progress", name: "In progress" },
          ],
        },
        { id: "PVTF_priority", name: "Priority", type: "text", options: [] },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps GitHub Project issue items into Kanban tasks", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            JSON.stringify({
              items: [
                {
                  id: "PVTI_task_1",
                  content: {
                    type: "Issue",
                    number: 43,
                    title: "Connect live GitHub Projects state",
                    repository: {
                      name: "kanban-console",
                      nameWithOwner: "MohAnghabo/kanban-console",
                    },
                    assignees: [{ login: "MohAnghabo" }],
                    updatedAt: "2026-05-06T13:54:28.000Z",
                    comments: 4,
                  },
                  fieldValues: [
                    { name: "Status", value: "In progress" },
                    { name: "Priority", value: "P1" },
                    { name: "Agent", value: "Codex" },
                    { name: "Pull Request", value: "kanban-console#3" },
                  ],
                },
              ],
            }),
          ),
        ),
      );

      const provider = yield* GitHubProjectsProvider.GitHubProjectsProvider;
      const result = yield* provider.listProjectItems({
        cwd: "/repo",
        owner: "MohAnghabo",
        projectNumber: 7,
        projectId: "PVT_kwDOExample",
        projectTitle: "Kanban Console",
      });

      assert.deepStrictEqual(result.board, {
        id: "PVT_kwDOExample",
        owner: "MohAnghabo",
        title: "Kanban Console",
        source: "github-projects",
        columns: ["backlog", "ready", "in-progress", "review", "blocked", "done"],
      });
      assert.deepStrictEqual(result.tasks, [
        {
          id: "PVTI_task_1",
          issue: "kanban-console#43",
          title: "Connect live GitHub Projects state",
          titleAr: "Connect live GitHub Projects state",
          repo: "kanban-console",
          column: "in-progress",
          priority: "P1",
          assignee: "MohAnghabo",
          pr: "kanban-console#3",
          checks: { passing: 0, pending: 0, failing: 0 },
          agent: "Codex",
          updated: "2026-05-06T13:54:28.000Z",
          comments: 4,
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("requires confirmation before writing Project status or comments", () =>
    Effect.gen(function* () {
      const provider = yield* GitHubProjectsProvider.GitHubProjectsProvider;

      const statusError = yield* provider
        .updateProjectItemStatus({
          cwd: "/repo",
          itemId: "PVTI_task_1",
          fromColumn: "ready",
          toColumn: "review",
          confirmed: false,
          projectId: "PVT_kwDOExample",
          statusFieldId: "PVTSSF_status",
          statusOptionId: "opt_review",
        })
        .pipe(Effect.flip);
      const commentError = yield* provider
        .postStatusMoveComment({
          cwd: "/repo",
          repository: "MohAnghabo/kanban-console",
          issueNumber: 43,
          body: "Status moved from Ready to In review.",
          confirmed: false,
        })
        .pipe(Effect.flip);

      expect(statusError.detail).toContain("require explicit confirmation");
      expect(commentError.detail).toContain("require explicit confirmation");
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer)),
  );

  it.effect("updates Project status and posts issue comments after confirmation", () =>
    Effect.gen(function* () {
      execute
        .mockReturnValueOnce(Effect.succeed(processOutput("")))
        .mockReturnValueOnce(Effect.succeed(processOutput("https://github.com/comment\n")));

      const provider = yield* GitHubProjectsProvider.GitHubProjectsProvider;
      const transition = yield* provider.updateProjectItemStatus({
        cwd: "/repo",
        itemId: "PVTI_task_1",
        fromColumn: "ready",
        toColumn: "review",
        confirmed: true,
        projectId: "PVT_kwDOExample",
        statusFieldId: "PVTSSF_status",
        statusOptionId: "opt_review",
      });
      yield* provider.postStatusMoveComment({
        cwd: "/repo",
        repository: "MohAnghabo/kanban-console",
        issueNumber: 43,
        body: "Status moved from Ready to In review.",
        confirmed: true,
      });

      assert.deepStrictEqual(transition, {
        taskId: "PVTI_task_1",
        fromColumn: "ready",
        toColumn: "review",
        action: "none",
        requiresConfirmation: false,
        duplicateSuppressed: false,
        message: "GitHub Project status updated.",
      });
      expect(execute).toHaveBeenNthCalledWith(1, {
        cwd: "/repo",
        args: [
          "project",
          "item-edit",
          "--id",
          "PVTI_task_1",
          "--project-id",
          "PVT_kwDOExample",
          "--field-id",
          "PVTSSF_status",
          "--single-select-option-id",
          "opt_review",
        ],
        timeoutMs: 30_000,
      });
      expect(execute).toHaveBeenNthCalledWith(2, {
        cwd: "/repo",
        args: [
          "issue",
          "comment",
          "43",
          "--repo",
          "MohAnghabo/kanban-console",
          "--body",
          "Status moved from Ready to In review.",
        ],
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );
});
