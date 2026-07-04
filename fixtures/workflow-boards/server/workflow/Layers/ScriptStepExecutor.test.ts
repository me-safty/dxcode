// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { ScriptCommandRunner, type ScriptCommandResult } from "../Services/ScriptCommandRunner.ts";
import { ScriptStepExecutor } from "../Services/ScriptStepExecutor.ts";
import type { StepExecutionContext } from "../Services/StepExecutor.ts";
import { WorkflowFilesystemCapability } from "../Services/WorkflowCapabilities.ts";
import { WorkflowEventStore } from "../Services/WorkflowEventStore.ts";
import { WorkflowReadModel } from "../Services/WorkflowReadModel.ts";
import { TestNodeFileSystemLive } from "../testNodeFileSystem.ts";
import { TestSql } from "../testHarness.ts";
import { WorkflowFoundationLive } from "../WorkflowFoundationLive.ts";
import { BoardRegistryLive } from "./BoardRegistry.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { ScriptStepExecutorLive } from "./ScriptStepExecutor.ts";

const containsRealPath = (root: string, target: string) => {
  const relative = NodePath.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

const WorkflowFilesystemCapabilityFake = Layer.succeed(WorkflowFilesystemCapability, {
  listRoots: () => Effect.succeed([]),
  readFile: () => Effect.die(new Error("unused readFile")),
  readFileString: () => Effect.die(new Error("unused readFileString")),
  readFileStringCapped: () => Effect.die(new Error("unused readFileStringCapped")),
  writeFile: () => Effect.void,
  writeFileString: () => Effect.void,
  createFileExclusive: () => Effect.void,
  exists: (input: { readonly root: string; readonly relativePath: string }) =>
    Effect.promise(() => NodeFSP.access(NodePath.join(input.root, input.relativePath))).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  stat: (input: { readonly root: string; readonly relativePath: string }) =>
    Effect.tryPromise(async () => {
      const root = await NodeFSP.realpath(input.root);
      const candidate = await NodeFSP.realpath(NodePath.join(root, input.relativePath));
      if (!containsRealPath(root, candidate)) {
        throw new Error("path escapes root");
      }
      const stat = await NodeFSP.stat(candidate);
      return {
        type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
        size: stat.size,
        mtime: stat.mtimeMs,
        realPath: candidate,
      } as const;
    }),
  listDir: () => Effect.succeed([]),
  listDirRecursive: () => Effect.succeed([]),
  makeDirectory: () => Effect.void,
  remove: () => Effect.void,
  rename: () => Effect.void,
} as never);

const context: StepExecutionContext = {
  ticketId: "ticket-script" as never,
  boardId: "board-script" as never,
  pipelineRunId: "pipeline-script" as never,
  stepRunId: "step-run-script" as never,
  laneEntryToken: "lane-token-script" as never,
  laneKey: "lane-script" as never,
  laneStepKeys: ["tests"] as never,
  step: {
    key: "tests" as never,
    type: "script",
    run: "pnpm test",
    cwd: "packages/app",
  },
};

const layer = (
  commandResult: ScriptCommandResult,
  inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }>,
  cancelEvents: string[] = [],
) =>
  ScriptStepExecutorLive.pipe(
    Layer.provideMerge(
      Layer.succeed(ScriptCancelRegistry, {
        register: (stepRunId, handle) =>
          Effect.sync(() => {
            cancelEvents.push(
              `register:${stepRunId}:${handle.scriptThreadId}:${handle.terminalId}`,
            );
          }),
        unregister: (stepRunId) =>
          Effect.sync(() => {
            cancelEvents.push(`unregister:${stepRunId}`);
          }),
        cancel: () => Effect.void,
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(ScriptCommandRunner, {
        run: (input) =>
          Effect.sync(() => {
            inputs.push({
              scriptThreadId: input.scriptThreadId,
              terminalId: input.terminalId,
              cwd: input.cwd,
              run: input.run,
            });
            return commandResult;
          }),
      }),
    ),
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(DeterministicWorkflowIds),
    Layer.provideMerge(WorkflowFilesystemCapabilityFake),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(TestSql),
    Layer.provideMerge(TestNodeFileSystemLive),
  );

const makeWorktree = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const worktreePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-script-step-" });
  const cwd = NodePath.join(worktreePath, "packages", "app");
  yield* fileSystem.makeDirectory(cwd, { recursive: true });
  return {
    repoRoot: worktreePath,
    worktreeRef: "workflow/ticket-script",
    path: worktreePath,
    cwd,
  };
});

const seedTicket = Effect.gen(function* () {
  const registry = yield* BoardRegistry;
  const read = yield* WorkflowReadModel;
  const sql = yield* SqlClient.SqlClient;
  yield* registry.register(context.boardId, {
    name: "Script board",
    lanes: [{ key: "impl", name: "Impl", entry: "manual" }],
  });
  yield* read.registerBoard({
    boardId: context.boardId,
    projectId: "project-script" as never,
    name: "Script board",
    workflowFilePath: ".t3/boards/script.json",
    workflowVersionHash: "hash-script",
    maxConcurrentTickets: 1,
  });
  yield* sql`
    INSERT INTO p_workflow_boards_projection_ticket (
      ticket_id,
      board_id,
      title,
      current_lane_key,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ${context.ticketId},
      ${context.boardId},
      'Script ticket',
      'impl',
      'running',
      '2026-06-07T00:00:00.000Z',
      '2026-06-07T00:00:00.000Z'
    )
    ON CONFLICT(ticket_id) DO NOTHING
  `;
});

it.effect("runs a script command in a contained cwd and commits start and exit events", () => {
  const inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }> = [];
  return Effect.gen(function* () {
    const worktree = yield* makeWorktree;
    const executor = yield* ScriptStepExecutor;
    const store = yield* WorkflowEventStore;
    yield* seedTicket;

    const outcome = yield* executor.execute({
      ctx: context,
      step: context.step as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      worktree,
    });

    assert.deepEqual(outcome, { _tag: "completed" });
    assert.deepEqual(inputs, [
      {
        scriptThreadId: "plugin:workflow-boards:script-scriptrun-1",
        terminalId: "script-scriptrun-1",
        cwd: yield* Effect.promise(() => NodeFSP.realpath(worktree.cwd)),
        run: "pnpm test",
      },
    ]);

    const events = yield* Stream.runCollect(store.readByTicket(context.ticketId)).pipe(
      Effect.map((chunk) => Array.from(chunk)),
    );
    const started = events.find((event) => event.type === "ScriptStepStarted");
    const exited = events.find((event) => event.type === "ScriptStepExited");
    assert.equal(started?.payload.scriptRunId, "scriptrun-1");
    assert.equal(started?.payload.scriptThreadId, "plugin:workflow-boards:script-scriptrun-1");
    assert.equal(started?.payload.terminalId, "script-scriptrun-1");
    assert.equal(exited?.payload.scriptRunId, "scriptrun-1");
    assert.equal(exited?.payload.exitCode, 0);
    assert.equal(exited?.payload.outcome, "exited");
  }).pipe(Effect.provide(layer({ outcome: "exited", exitCode: 0, signal: null }, inputs)));
});

it.effect("registers the script terminal as cancellable while the command is running", () => {
  const inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }> = [];
  const cancelEvents: string[] = [];
  return Effect.gen(function* () {
    const worktree = yield* makeWorktree;
    const executor = yield* ScriptStepExecutor;
    yield* seedTicket;

    const outcome = yield* executor.execute({
      ctx: context,
      step: context.step as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      worktree,
    });

    assert.deepEqual(outcome, { _tag: "completed" });
    assert.deepEqual(cancelEvents, [
      "register:step-run-script:plugin:workflow-boards:script-scriptrun-1:script-scriptrun-1",
      "unregister:step-run-script",
    ]);
  }).pipe(
    Effect.provide(layer({ outcome: "exited", exitCode: 0, signal: null }, inputs, cancelEvents)),
  );
});

it.effect("rejects a script cwd that escapes the worktree before running a command", () => {
  const inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }> = [];
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const worktree = yield* makeWorktree;
    const outside = NodePath.join(NodePath.dirname(worktree.path), "outside");
    yield* fileSystem.makeDirectory(outside, { recursive: true });
    const executor = yield* ScriptStepExecutor;

    const outcome = yield* executor.execute({
      ctx: {
        ...context,
        step: {
          ...context.step,
          cwd: "../outside",
        } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      },
      step: {
        ...context.step,
        cwd: "../outside",
      } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      worktree,
    });

    assert.deepEqual(outcome, { _tag: "failed", error: "script cwd escapes worktree" });
    assert.deepEqual(inputs, []);
  }).pipe(Effect.provide(layer({ outcome: "exited", exitCode: 0, signal: null }, inputs)));
});

it.effect("rejects a script cwd symlink that resolves outside the worktree", () => {
  const inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }> = [];
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const worktree = yield* makeWorktree;
    const outside = NodePath.join(NodePath.dirname(worktree.path), "outside-symlink-target");
    const link = NodePath.join(worktree.path, "linked-outside");
    yield* fileSystem.makeDirectory(outside, { recursive: true });
    yield* Effect.promise(() => NodeFSP.symlink(outside, link));
    const executor = yield* ScriptStepExecutor;

    const outcome = yield* executor.execute({
      ctx: {
        ...context,
        step: {
          ...context.step,
          cwd: "linked-outside",
        } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      },
      step: {
        ...context.step,
        cwd: "linked-outside",
      } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      worktree,
    });

    assert.deepEqual(outcome, { _tag: "failed", error: "script cwd invalid" });
    assert.deepEqual(inputs, []);
  }).pipe(Effect.provide(layer({ outcome: "exited", exitCode: 0, signal: null }, inputs)));
});

it.effect("runs a script command from the resolved cwd realpath", () => {
  const inputs: Array<{
    readonly scriptThreadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly run: string;
  }> = [];
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const worktree = yield* makeWorktree;
    const realPackage = NodePath.join(worktree.path, "packages", "real-app");
    const logicalLink = NodePath.join(worktree.path, "packages", "linked-app");
    yield* fileSystem.makeDirectory(realPackage, { recursive: true });
    yield* Effect.promise(() => NodeFSP.symlink(realPackage, logicalLink));
    const executor = yield* ScriptStepExecutor;
    yield* seedTicket;

    const outcome = yield* executor.execute({
      ctx: {
        ...context,
        step: {
          ...context.step,
          cwd: "packages/linked-app",
        } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      },
      step: {
        ...context.step,
        cwd: "packages/linked-app",
      } as Extract<StepExecutionContext["step"], { readonly type: "script" }>,
      worktree,
    });

    assert.deepEqual(outcome, { _tag: "completed" });
    assert.equal(inputs[0]?.cwd, yield* Effect.promise(() => NodeFSP.realpath(realPackage)));
  }).pipe(Effect.provide(layer({ outcome: "exited", exitCode: 0, signal: null }, inputs)));
});
