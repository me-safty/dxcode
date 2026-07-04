import { assert, describe, it } from "@effect/vitest";
import { GitCommandError } from "@t3tools/contracts";
import type { MergeStep, TicketId } from "../../../contracts/workflow.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TicketMergeService } from "../Services/TicketMergeService.ts";
import { WorkflowVcsCapability } from "../Services/WorkflowCapabilities.ts";
import { WorkflowReadModel, type WorkflowReadModelShape } from "../Services/WorkflowReadModel.ts";
import { TicketMergeServiceLive } from "./TicketMergeService.ts";

const redactedGitError = (stderr: string): GitCommandError =>
  Object.assign(
    new GitCommandError({
      operation: "PluginVcsCapability.merge",
      command: "git",
      cwd: "/repo",
      argumentCount: 2,
      exitCode: 128,
      stderrLength: stderr.length,
      detail: "Git command exited with a non-zero status.",
    }),
    { stderr },
  );

const mergeInput = (step: Partial<MergeStep> = {}) => ({
  ticketId: "ticket-merge" as TicketId,
  repoRoot: "/repo",
  worktreePath: "/repo-worktrees/ticket-merge",
  worktreeRef: "workflow/ticket-merge",
  step: {
    key: "land" as never,
    type: "merge" as const,
    ...step,
  },
});

const readModelLayer = Layer.succeed(WorkflowReadModel, {
  getTicketDetail: () =>
    Effect.succeed({
      ticket: {
        ticketId: "ticket-merge",
        boardId: "board-1",
        title: "Fix login",
        description: null,
        currentLaneKey: "land",
        currentLaneEntryToken: "token-1",
        queuedAt: null,
        status: "running",
      },
      steps: [],
      messages: [],
    }),
} as unknown as WorkflowReadModelShape);

const vcsLayer = (calls: Array<{ readonly op: string; readonly path?: string | undefined }> = []) =>
  Layer.succeed(WorkflowVcsCapability, {
    status: () => Effect.succeed({ hasWorkingTreeChanges: false }),
    listWorktrees: () => Effect.die("unused listWorktrees"),
    createWorktree: () => Effect.die("unused createWorktree"),
    removeWorktree: () => Effect.die("unused removeWorktree"),
    createBranch: () => Effect.die("unused createBranch"),
    switchRef: () => Effect.die("unused switchRef"),
    removePath: ({ path }: { readonly path: string }) =>
      Effect.sync(() => {
        calls.push({ op: "removePath", path });
      }),
    clean: ({ path }: { readonly path: string }) =>
      Effect.sync(() => {
        calls.push({ op: "clean", path });
      }),
    currentBranch: () => Effect.succeed("main"),
    aheadCount: () => Effect.succeed(1),
    listRefs: () => Effect.die("unused listRefs"),
    commit: () => Effect.succeed({ status: "skipped_no_changes" }),
    merge: () => Effect.fail(redactedGitError("fatal: refusing to merge unrelated histories")),
    push: () => Effect.die("unused push"),
    workingTreeDiff: () => Effect.die("unused workingTreeDiff"),
    diffRefs: () => Effect.die("unused diffRefs"),
    createCheckpoint: () => Effect.die("unused createCheckpoint"),
    hasCheckpoint: () => Effect.die("unused hasCheckpoint"),
    restoreCheckpoint: () => Effect.die("unused restoreCheckpoint"),
    deleteCheckpoints: () => Effect.die("unused deleteCheckpoints"),
  } as never);

describe("TicketMergeServiceLive", () => {
  it.effect("blocks, instead of failing, on a non-conflict merge error", () => {
    const calls: Array<{ readonly op: string; readonly path?: string | undefined }> = [];
    return Effect.gen(function* () {
      const service = yield* TicketMergeService;

      const outcome = yield* service.merge(mergeInput());

      assert.equal(outcome._tag, "blocked");
      if (outcome._tag === "blocked") {
        assert.match(outcome.reason, /^Merge failed:/);
        assert.include(outcome.reason, "unrelated histories");
      }
      assert.ok(calls.some((call) => call.op === "removePath" && call.path?.includes(".t3")));
      assert.ok(calls.some((call) => call.op === "clean" && call.path?.includes(".t3")));
    }).pipe(
      Effect.provide(
        TicketMergeServiceLive.pipe(
          Layer.provideMerge(vcsLayer(calls)),
          Layer.provideMerge(readModelLayer),
        ),
      ),
    );
  });
});
