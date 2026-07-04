import type { StepOutcome } from "../../../contracts/workflow.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { applyInstructionTemplate, type TicketTemplateVars } from "../instructionTemplate.ts";
import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { GitHubPort } from "../Services/GitHubPort.ts";
import { MergeGitPort } from "../Services/TicketMergeService.ts";
import {
  TicketPullRequestService,
  type TicketPullRequestInput,
  type TicketPullRequestServiceShape,
} from "../Services/TicketPullRequestService.ts";
import { WorkflowEventCommitter } from "../Services/WorkflowEventCommitter.ts";
import type { WorkflowEventInput } from "../Services/WorkflowEventStore.ts";
import { WorkflowIds } from "../Services/WorkflowIds.ts";
import { WorkflowReadModel } from "../Services/WorkflowReadModel.ts";
import { cleanupTicketScratch } from "./ticketScratchCleanup.ts";

const blocked = (reason: string): StepOutcome => ({ _tag: "blocked", reason });

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const make = Effect.gen(function* () {
  const github = yield* GitHubPort;
  const git = yield* MergeGitPort;
  const read = yield* WorkflowReadModel;
  const committer = yield* WorkflowEventCommitter;
  const ids = yield* WorkflowIds;

  const open: TicketPullRequestServiceShape["open"] = (input) =>
    Effect.gen(function* () {
      const preflight = yield* github.preflight(input.worktreePath);
      if (!preflight.ok) {
        return blocked(preflight.reason);
      }

      const base = input.step.base ?? (yield* github.defaultBranch(input.worktreePath));
      const detail = yield* read.getTicketDetail(input.ticketId);
      const ticketTitle = detail?.ticket.title ?? "workflow ticket";
      const vars: TicketTemplateVars = {
        title: ticketTitle,
        description: detail?.ticket.description ?? "",
        id: input.ticketId as string,
        baseRef: base,
        discussion: "",
      };

      const snapshotMessage =
        input.step.titleTemplate !== undefined
          ? applyInstructionTemplate(input.step.titleTemplate, vars)
          : `${ticketTitle} (${input.ticketId})`;
      yield* cleanupTicketScratch(git, input.worktreePath, input.ticketId as string);
      const worktreeStatus = yield* git.run({
        cwd: input.worktreePath,
        args: ["status", "--porcelain"],
      });
      if (worktreeStatus.stdout.trim().length > 0) {
        yield* git.run({ cwd: input.worktreePath, args: ["add", "-A"] });
        yield* git.run({
          cwd: input.worktreePath,
          args: ["commit", "--no-verify", "-m", snapshotMessage],
        });
      }

      const title =
        input.step.titleTemplate !== undefined
          ? applyInstructionTemplate(input.step.titleTemplate, vars)
          : ticketTitle;
      const renderedBody =
        input.step.bodyTemplate !== undefined
          ? applyInstructionTemplate(input.step.bodyTemplate, vars)
          : "";
      const body = `${renderedBody}${renderedBody ? "\n\n" : ""}t3-ticket: ${input.ticketId}`;

      const result = yield* github
        .openPr({
          cwd: input.worktreePath,
          branch: input.worktreeRef,
          base,
          title,
          body,
          draft: input.step.draft ?? false,
        })
        .pipe(
          Effect.mapError((error) => error as WorkflowEventStoreError),
          Effect.catchIf(
            (error) => error.message.startsWith("branch diverged"),
            (error) => Effect.succeed({ _blocked: error.message } as const),
          ),
        );
      if ("_blocked" in result) {
        return blocked(result._blocked);
      }

      const remote = yield* github.resolveRemote(input.worktreePath);
      const eventId = yield* ids.eventId();
      yield* committer.commit({
        type: "TicketPrOpened",
        eventId,
        ticketId: input.ticketId,
        occurredAt: yield* nowIso,
        payload: {
          stepRunId: input.stepRunId,
          prNumber: result.number,
          url: result.url,
          branch: input.worktreeRef,
          remoteName: remote.remoteName,
          repo: remote.repo,
        },
      } as WorkflowEventInput);

      return {
        _tag: "completed",
        output: { prNumber: result.number, url: result.url },
      };
    });

  const land: TicketPullRequestServiceShape["land"] = (input: TicketPullRequestInput) =>
    Effect.gen(function* () {
      const state = yield* read.getTicketPrState(input.ticketId);
      if (state === null) {
        return blocked("no PR to land");
      }

      const result = yield* github.mergePr({
        cwd: input.worktreePath,
        prNumber: state.prNumber,
        strategy: input.step.strategy ?? "squash",
        deleteBranch: input.step.deleteBranch ?? true,
        branch: state.branch,
        remoteName: state.remoteName,
      });
      if (!result.ok) {
        return blocked(result.reason);
      }
      return { _tag: "completed" };
    });

  return { open, land } satisfies TicketPullRequestServiceShape;
});

export const TicketPullRequestServiceLive = Layer.effect(TicketPullRequestService, make);
