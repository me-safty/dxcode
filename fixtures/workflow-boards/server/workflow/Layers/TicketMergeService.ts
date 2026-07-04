import type { StepOutcome, TicketId } from "../../../contracts/workflow.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkflowEventStoreError } from "../Services/Errors.ts";
import {
  MergeGitPort,
  TicketMergeService,
  type MergeGitPortShape,
  type TicketMergeServiceShape,
} from "../Services/TicketMergeService.ts";
import { WorkflowVcsCapability } from "../Services/WorkflowCapabilities.ts";
import { WorkflowReadModel } from "../Services/WorkflowReadModel.ts";
import { ticketScratchDir } from "../instructionTemplate.ts";

const blocked = (reason: string): StepOutcome => ({ _tag: "blocked", reason });
const completed: StepOutcome = { _tag: "completed" };

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const errorText = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const fields = error as {
      readonly stderr?: unknown;
      readonly cause?: unknown;
      readonly detail?: unknown;
      readonly message?: unknown;
    };
    const stderr = stringField(fields.stderr);
    if (stderr !== null) return stderr;
    if (fields.cause !== undefined && fields.cause !== null) {
      const causeText = errorText(fields.cause);
      if (causeText.trim().length > 0) return causeText;
    }
    const detail = stringField(fields.detail);
    if (detail !== null) return detail;
    const message = stringField(fields.message);
    if (message !== null) return message;
  }
  return error instanceof Error ? error.message : String(error);
};

const resolveCleanupPath = (path: string, ticketId: string): string =>
  path.replace(/\{\{\s*ticket\.id\s*\}\}/g, ticketId);

const conflictSummary = (files: ReadonlyArray<string>, output: string) => {
  if (files.length > 0) {
    return files.slice(0, 5).join(", ");
  }
  return output
    .split("\n")
    .filter((line) => line.includes("CONFLICT"))
    .slice(0, 5)
    .join("; ");
};

const purgePath = (vcs: WorkflowVcsCapability["Service"], worktreePath: string, path: string) =>
  Effect.all(
    [
      vcs.removePath({ worktreePath, path }).pipe(Effect.ignore),
      vcs.clean({ worktreePath, path }).pipe(Effect.ignore),
    ],
    { discard: true },
  ).pipe(
    Effect.mapError((cause) => new WorkflowEventStoreError({ message: "cleanup failed", cause })),
  );

const purgeScratch = (
  vcs: WorkflowVcsCapability["Service"],
  worktreePath: string,
  ticketId: TicketId,
) => purgePath(vcs, worktreePath, ticketScratchDir(ticketId as string));

const make = Effect.gen(function* () {
  const vcs = yield* WorkflowVcsCapability;
  const read = yield* WorkflowReadModel;

  const merge: TicketMergeServiceShape["merge"] = (input) =>
    Effect.gen(function* () {
      const detail = yield* read.getTicketDetail(input.ticketId);
      const rawMessage = input.step.commitMessage?.trim();
      const message =
        rawMessage !== undefined && rawMessage.length > 0
          ? rawMessage
          : `${detail?.ticket.title ?? "workflow ticket"} (${input.ticketId})`;

      yield* purgeScratch(vcs, input.worktreePath, input.ticketId);
      for (const rawCleanupPath of input.step.cleanupPaths ?? []) {
        yield* purgePath(
          vcs,
          input.worktreePath,
          resolveCleanupPath(rawCleanupPath as string, input.ticketId as string),
        );
      }

      const worktreeStatus = yield* vcs
        .status({ worktreePath: input.worktreePath })
        .pipe(
          Effect.mapError(
            (cause) => new WorkflowEventStoreError({ message: "status failed", cause }),
          ),
        );
      if (worktreeStatus.hasWorkingTreeChanges) {
        yield* vcs
          .commit({
            worktreePath: input.worktreePath,
            subject: message,
            noVerify: true,
          })
          .pipe(
            Effect.mapError(
              (cause) => new WorkflowEventStoreError({ message: "commit failed", cause }),
            ),
          );
      }

      const repoStatus = yield* vcs
        .status({ worktreePath: input.repoRoot })
        .pipe(
          Effect.mapError(
            (cause) => new WorkflowEventStoreError({ message: "repo status failed", cause }),
          ),
        );
      if (repoStatus.hasWorkingTreeChanges) {
        return blocked(
          "Repo working tree has uncommitted changes; commit or stash them, then re-run the lane.",
        );
      }

      const branch = yield* vcs
        .currentBranch({ worktreePath: input.repoRoot })
        .pipe(
          Effect.mapError(
            (cause) => new WorkflowEventStoreError({ message: "branch lookup failed", cause }),
          ),
        );
      if (branch === "HEAD") {
        return blocked("Repo is on a detached HEAD; check out a branch first.");
      }
      if (input.step.target !== undefined && branch !== input.step.target) {
        return blocked(
          `Repo has "${branch}" checked out but this step merges into "${input.step.target}".`,
        );
      }

      const ahead = yield* vcs
        .aheadCount({
          worktreePath: input.repoRoot,
          base: "HEAD",
          head: input.worktreeRef,
        })
        .pipe(
          Effect.mapError(
            (cause) => new WorkflowEventStoreError({ message: "ahead count failed", cause }),
          ),
        );
      if (ahead === 0) {
        return completed;
      }

      const result = yield* vcs
        .merge({
          worktreePath: input.repoRoot,
          ref: input.worktreeRef,
          message,
          noFf: true,
          noVerify: true,
          abortOnConflict: true,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.succeed(
              blocked(`Merge failed: ${firstLine(errorText(cause)) || "unknown git error"}`),
            ),
          ),
        );
      if ("_tag" in result) {
        return result;
      }
      if (result.status === "conflict") {
        const conflicts = conflictSummary(
          result.conflictedFiles,
          `${result.stdout}\n${result.stderr}`,
        );
        return blocked(
          conflicts.length > 0
            ? `Merge conflict: ${conflicts}`
            : `Merge failed: ${firstLine(result.stderr) || firstLine(result.stdout) || "unknown git error"}`,
        );
      }

      return completed;
    });

  return { merge } satisfies TicketMergeServiceShape;
});

export const TicketMergeServiceLive = Layer.effect(TicketMergeService, make);

export const MergeGitPortLive = Layer.effect(
  MergeGitPort,
  Effect.gen(function* () {
    const vcs = yield* WorkflowVcsCapability;

    const run: MergeGitPortShape["run"] = (input) =>
      Effect.gen(function* () {
        const [command, ...args] = input.args;
        if (command === "status" && args[0] === "--porcelain") {
          const status = yield* vcs.status({ worktreePath: input.cwd });
          return {
            exitCode: 0,
            stdout: status.hasWorkingTreeChanges ? " M workflow-change\n" : "",
            stderr: "",
          };
        }
        if (command === "add") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command === "commit") {
          const message = args[args.indexOf("-m") + 1] ?? "workflow snapshot";
          const result = yield* vcs.commit({
            worktreePath: input.cwd,
            subject: message,
            noVerify: args.includes("--no-verify"),
          });
          return {
            exitCode: 0,
            stdout: result.status === "created" ? result.commitSha : "",
            stderr: "",
          };
        }
        if (command === "rm") {
          const target = args.at(-1);
          if (target !== undefined) {
            yield* vcs.removePath({ worktreePath: input.cwd, path: target }).pipe(Effect.ignore);
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command === "clean") {
          const target = args.at(-1);
          if (target !== undefined) {
            yield* vcs.clean({ worktreePath: input.cwd, path: target }).pipe(Effect.ignore);
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command === "push") {
          const remoteName = args[0] === "-u" ? args[1] : args[0];
          const result = yield* vcs.push({
            worktreePath: input.cwd,
            ...(remoteName === undefined ? {} : { remoteName }),
          });
          return { exitCode: 0, stdout: result.status, stderr: "" };
        }
        if (input.allowNonZeroExit) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `unsupported git command: ${input.args.join(" ")}`,
          };
        }
        return yield* new WorkflowEventStoreError({
          message: `unsupported git command: ${input.args.join(" ")}`,
        });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkflowEventStoreError({
              message: "workflow merge git command failed",
              cause,
            }),
        ),
      );

    return { run } satisfies MergeGitPortShape;
  }),
);
