import {
  EnvironmentId,
  type OrchestrationCommand,
  type TaskRuntimeMaterializeRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectSetupScriptRunner } from "../project/Services/ProjectSetupScriptRunner.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import {
  ExecutionBridgeRunRegistryLive,
  materializeTaskRuntime,
  taskRuntimeWorktreeCreateInput,
} from "./runStart.ts";

describe("task runtime worktree creation", () => {
  it("requests an origin base refresh before materializing task worktrees", () => {
    expect(
      taskRuntimeWorktreeCreateInput(
        {
          project: {
            repoName: "example-app",
            workspaceRoot: "C:\\Users\\example\\dev\\example-app",
            defaultBranch: "dev",
          },
        },
        "t3code/fresh-base",
      ),
    ).toEqual({
      cwd: "C:\\Users\\example\\dev\\example-app",
      refName: "dev",
      newRefName: "t3code/fresh-base",
      path: null,
      refreshBaseFromOrigin: true,
    });
  });

  it("runs the project setup script runner after materializing orchestrator task worktrees", async () => {
    const dispatchedCommands: OrchestrationCommand[] = [];
    const createWorktree = vi.fn(() =>
      Effect.succeed({
        worktree: {
          refName: "t3code/task-branch",
          path: "C:\\Users\\example\\dev\\example-app-t3-worktree",
        },
      }),
    );
    const runForThread = vi.fn(() => Effect.succeed({ status: "no-script" as const }));
    const request = {
      taskId: "task-1",
      workSessionId: "session-1",
      initialPrompt: "fix it",
      project: {
        repoName: "example-app",
        workspaceRoot: "C:\\Users\\example\\dev\\example-app",
        defaultBranch: "dev",
      },
      title: "Fix it",
      runtimeMode: "full-access",
      interactionMode: "default",
      startCodingAgent: true,
    } satisfies TaskRuntimeMaterializeRequest;

    const layer = Layer.mergeAll(
      ExecutionBridgeRunRegistryLive,
      Layer.mock(ProjectionSnapshotQuery)({
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.sync(() => {
            dispatchedCommands.push(command);
            return { sequence: dispatchedCommands.length };
          }),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      }),
      Layer.mock(GitVcsDriver)({
        createWorktree,
      }),
      Layer.mock(ProjectSetupScriptRunner)({
        runForThread,
      }),
      Layer.mock(ServerEnvironment)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-test")),
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make("environment-test"),
          label: "Test environment",
          platform: {
            os: "windows",
            arch: "x64",
          },
          serverVersion: "0.0.0-test",
          capabilities: {
            repositoryIdentity: true,
          },
        }),
      }),
      FileSystem.layerNoop({}),
      Path.layer,
      Layer.succeed(ServerConfig, {
        attachmentsDir: "C:\\Users\\Vivek\\Affil\\t3code\\.test-attachments",
      } as ServerConfigShape),
    );

    const response = await Effect.runPromise(
      materializeTaskRuntime(request).pipe(Effect.provide(layer)),
    );

    expect(dispatchedCommands.map((command) => command.type)).toEqual([
      "project.create",
      "thread.create",
      "thread.turn.start",
    ]);
    expect(
      dispatchedCommands.find((command) => command.type === "thread.turn.start")?.message.text,
    ).toBe("fix it");
    expect(runForThread).toHaveBeenCalledWith({
      threadId: response.t3ThreadId,
      projectId: response.t3ProjectId,
      projectCwd: "C:\\Users\\example\\dev\\example-app",
      worktreePath: "C:\\Users\\example\\dev\\example-app-t3-worktree",
    });
    expect(createWorktree).toHaveBeenCalledWith({
      cwd: "C:\\Users\\example\\dev\\example-app",
      refName: "dev",
      newRefName: expect.stringMatching(/^t3code\//),
      path: null,
      refreshBaseFromOrigin: true,
    });
  });
});
