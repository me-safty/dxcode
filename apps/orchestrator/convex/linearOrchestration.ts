"use node";

import { v } from "convex/values";

import { createLinearPlatformAdapter } from "../src/adapters/linear.ts";
import { buildLinearExecutionPrompt, buildLinearLifecycleReply } from "../src/linear/replies.ts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

interface StartRunFromLinearWebhookResult {
  readonly acceptedAt: string;
  readonly controlThreadId: string;
  readonly executionRunId: string;
  readonly t3ThreadId: string;
}

interface PostExecutionReplyIfNeededResult {
  readonly posted: boolean;
  readonly reason: string;
  readonly replyCommentId?: string;
}

interface ExecutionRunForReply {
  readonly controlThreadId: Id<"controlThreads">;
  readonly executionRunId: string;
  readonly failureSummary?: string;
  readonly linearReplyCommentId?: string;
  readonly status: "requested" | "accepted" | "started" | "completed" | "failed";
  readonly t3ThreadId?: string;
}

interface ControlThreadForReply {
  readonly id: Id<"controlThreads">;
  readonly issueId: string;
  readonly commentId?: string;
  readonly linearAgentSessionId?: string;
}

export const handleLinearWebhookIngress = internalAction({
  args: {
    eventId: v.string(),
    linearThreadKey: v.string(),
    issueId: v.string(),
    issueIdentifier: v.optional(v.string()),
    commentId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    teamId: v.optional(v.string()),
    threadKind: v.union(v.literal("issue"), v.literal("comment")),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    authorName: v.optional(v.string()),
    body: v.string(),
    bodyPreview: v.optional(v.string()),
    commentUrl: v.optional(v.string()),
    receivedAt: v.number(),
    shouldStartRun: v.boolean(),
  },
  returns: v.object({
    controlThreadId: v.string(),
    threadKey: v.string(),
    createdThread: v.boolean(),
    eventApplied: v.boolean(),
    shouldStartRun: v.boolean(),
    executionRun: v.optional(
      v.object({
        acceptedAt: v.string(),
        controlThreadId: v.string(),
        executionRunId: v.string(),
        t3ThreadId: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(internal.controlThreads.upsertFromLinearIngress, args);

    let executionRun:
      | {
          readonly acceptedAt: string;
          readonly controlThreadId: string;
          readonly executionRunId: string;
          readonly t3ThreadId: string;
        }
      | undefined;

    if (result.eventApplied && result.shouldStartRun) {
      const existingRuns = await ctx.runQuery(internal.executionRuns.listRunsForControlThread, {
        controlThreadId: result.controlThreadId,
        limit: 1,
      });

      if (existingRuns.length > 0 && existingRuns[0]!.t3ThreadId) {
        const continueResult = await ctx.runAction(internal.executionRuns.continueWorkerRun, {
          controlThreadId: result.controlThreadId,
          prompt: buildLinearExecutionPrompt({
            issueId: args.issueId,
            linearThreadKey: args.linearThreadKey,
            body: args.body,
            ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
            ...(args.authorName !== undefined ? { authorName: args.authorName } : {}),
            ...(args.commentUrl !== undefined ? { commentUrl: args.commentUrl } : {}),
          }),
        });
        executionRun = {
          controlThreadId: String(result.controlThreadId),
          executionRunId: continueResult.executionRunId,
          t3ThreadId: continueResult.t3ThreadId,
          acceptedAt: continueResult.acceptedAt,
        };
      } else {
        executionRun = await ctx.runAction(internal.linearOrchestration.startRunFromLinearWebhook, {
          controlThreadId: result.controlThreadId,
          issueId: args.issueId,
          linearThreadKey: args.linearThreadKey,
          body: args.body,
          ...(args.issueIdentifier !== undefined ? { issueIdentifier: args.issueIdentifier } : {}),
          ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
          ...(args.authorName !== undefined ? { authorName: args.authorName } : {}),
          ...(args.commentUrl !== undefined ? { commentUrl: args.commentUrl } : {}),
        });
      }
    }

    if (result.eventApplied && !result.shouldStartRun && args.body === "__stop__") {
      await ctx.runAction(internal.executionRuns.interruptWorkerRun, {
        controlThreadId: result.controlThreadId,
      });
    }

    return {
      ...result,
      controlThreadId: String(result.controlThreadId),
      ...(executionRun !== undefined ? { executionRun } : {}),
    };
  },
});

export const startRunFromLinearWebhook = internalAction({
  args: {
    controlThreadId: v.id("controlThreads"),
    issueId: v.string(),
    issueIdentifier: v.optional(v.string()),
    linearThreadKey: v.string(),
    messageId: v.optional(v.string()),
    authorName: v.optional(v.string()),
    body: v.string(),
    commentUrl: v.optional(v.string()),
  },
  returns: v.object({
    controlThreadId: v.string(),
    executionRunId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.string(),
  }),
  handler: async (ctx, args): Promise<StartRunFromLinearWebhookResult> => {
    const workspaceRoot = process.env.LINEAR_DEFAULT_WORKSPACE_ROOT?.trim();
    if (!workspaceRoot) {
      throw new Error(
        "Missing LINEAR_DEFAULT_WORKSPACE_ROOT. Set it before testing the Linear MVP trigger path.",
      );
    }

    const initialPrompt = buildLinearExecutionPrompt({
      issueId: args.issueId,
      linearThreadKey: args.linearThreadKey,
      body: args.body,
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
      ...(args.authorName !== undefined ? { authorName: args.authorName } : {}),
      ...(args.commentUrl !== undefined ? { commentUrl: args.commentUrl } : {}),
    });

    try {
      const adapter = createLinearPlatformAdapter();
      const agentSessionId = await adapter.createAgentSession(args.issueId);
      if (agentSessionId) {
        await ctx.runMutation(internal.controlThreads.setAgentSessionId, {
          controlThreadId: args.controlThreadId,
          agentSessionId,
        });
        await adapter.postActivity(
          { platform: "linear", issueId: args.issueId, agentSessionId },
          { type: "thought", body: "Preparing workspace..." },
        );
      }
    } catch {
      // Agent session creation is best-effort — don't block the run
    }

    const accepted = await ctx.runAction(internal.executionRuns.startSingleWorkerRun, {
      controlThreadId: args.controlThreadId,
      initialPrompt,
      workspaceRoot,
      title: args.issueIdentifier ?? `Linear ${args.issueId}`,
    });
    return accepted;
  },
});

export const postExecutionReplyIfNeeded = internalAction({
  args: {
    executionRunId: v.string(),
  },
  returns: v.object({
    posted: v.boolean(),
    reason: v.string(),
    replyCommentId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<PostExecutionReplyIfNeededResult> => {
    const run = (await ctx.runQuery(internal.executionRuns.getExecutionRun, {
      executionRunId: args.executionRunId,
    })) as ExecutionRunForReply | null;
    if (run === null) {
      return {
        posted: false,
        reason: "missing_execution_run",
      };
    }

    if (run.status !== "completed" && run.status !== "failed") {
      return {
        posted: false,
        reason: "run_not_final",
      };
    }

    const claim = await ctx.runMutation(internal.executionRuns.claimLinearReplySlot, {
      executionRunId: args.executionRunId,
    });
    if (!claim.claimed) {
      return { posted: false, reason: "already_claimed" };
    }

    const controlThread = (await ctx.runQuery(internal.controlThreads.getControlThread, {
      controlThreadId: run.controlThreadId,
    })) as ControlThreadForReply | null;
    if (controlThread === null) {
      return {
        posted: false,
        reason: "missing_control_thread",
      };
    }

    const replyBody = buildLinearLifecycleReply({
      executionRunId: run.executionRunId,
      status: run.status,
      ...(run.t3ThreadId !== undefined ? { t3ThreadId: run.t3ThreadId } : {}),
      ...(run.failureSummary !== undefined ? { failureSummary: run.failureSummary } : {}),
    });

    const adapter = createLinearPlatformAdapter();
    const threadRef = {
      platform: "linear" as const,
      issueId: controlThread.issueId,
      ...(controlThread.commentId !== undefined ? { commentId: controlThread.commentId } : {}),
      ...(controlThread.linearAgentSessionId !== undefined
        ? { agentSessionId: controlThread.linearAgentSessionId }
        : {}),
    };

    let replyCommentId: string;
    if (controlThread.linearAgentSessionId) {
      await adapter.postActivity(threadRef, { type: "response", body: replyBody });
      replyCommentId = `activity:${controlThread.linearAgentSessionId}`;
    } else {
      const messageRef = await adapter.postMessage(threadRef, { markdown: replyBody });
      replyCommentId = messageRef.messageId;
    }

    await ctx.runMutation(internal.executionRuns.recordLinearReplyPosted, {
      executionRunId: run.executionRunId,
      replyCommentId,
      postedAt: Date.now(),
      bodyPreview: replyBody.slice(0, 240),
    });

    return {
      posted: true,
      reason: "posted",
      replyCommentId: messageRef.messageId,
    };
  },
});
