import {
  type ExecutionRunCreateRequest,
  type ExecutionRunContinueRequest,
  type ExecutionRunInterruptRequest,
  type RuntimeMode,
  type ModelSelection,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import { v } from "convex/values";

import {
  canApplyLifecycleEvent,
  deriveNextStatus,
  isTerminalStatus,
} from "../src/executionLifecycle.ts";
import type { ExecutionRunStatus } from "../src/executionLifecycle.ts";
import { createT3ExecutionBridgeClient } from "../src/t3/client.ts";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const createRequestedRunArgs = {
  controlThreadId: v.id("controlThreads"),
  executionRunId: v.string(),
  initialPrompt: v.string(),
  workspaceRoot: v.string(),
  title: v.optional(v.string()),
  runtimeMode: v.string(),
  interactionMode: v.string(),
  modelSelectionJson: v.optional(v.string()),
  requestedAt: v.number(),
} as const;

export const createRequestedRun = internalMutation({
  args: createRequestedRunArgs,
  returns: v.object({
    runDocId: v.id("executionRuns"),
  }),
  handler: async (ctx, args) => {
    const controlThread = await ctx.db.get(args.controlThreadId);
    if (controlThread === null) {
      throw new Error(`Control thread ${args.controlThreadId} does not exist`);
    }

    const existingRun = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (existingRun !== null) {
      return { runDocId: existingRun._id };
    }

    const runDocId = await ctx.db.insert("executionRuns", {
      executionRunId: args.executionRunId,
      controlThreadId: args.controlThreadId,
      status: "requested",
      initialPrompt: args.initialPrompt,
      workspaceRoot: args.workspaceRoot,
      runtimeMode: args.runtimeMode,
      interactionMode: args.interactionMode,
      requestedAt: args.requestedAt,
      updatedAt: args.requestedAt,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.modelSelectionJson !== undefined
        ? { modelSelectionJson: args.modelSelectionJson }
        : {}),
    });

    return { runDocId };
  },
});

export const attachT3Acceptance = internalMutation({
  args: {
    executionRunId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      throw new Error(`Execution run ${args.executionRunId} does not exist`);
    }

    await ctx.db.patch(run._id, {
      status: run.status === "requested" ? "accepted" : run.status,
      t3ThreadId: args.t3ThreadId,
      acceptedAt: args.acceptedAt,
      updatedAt: args.acceptedAt,
    });
    return null;
  },
});

export const applyLifecycleEvent = internalMutation({
  args: {
    eventId: v.string(),
    executionRunId: v.string(),
    controlThreadId: v.string(),
    type: v.union(
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("interrupted"),
    ),
    occurredAt: v.string(),
    t3ThreadId: v.optional(v.string()),
    t3TurnId: v.optional(v.string()),
    failureSummary: v.optional(v.string()),
  },
  returns: v.object({
    applied: v.boolean(),
    status: executionRunStateForReturns(),
  }),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("executionRunEvents")
      .withIndex("by_event_id", (query: any) => query.eq("eventId", args.eventId))
      .unique();
    if (existingEvent !== null) {
      const run = await ctx.db
        .query("executionRuns")
        .withIndex("by_execution_run_id", (query: any) =>
          query.eq("executionRunId", args.executionRunId),
        )
        .unique();
      return {
        applied: false,
        status: (run?.status ?? "failed") as ExecutionRunStatus,
      };
    }

    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      throw new Error(`Execution run ${args.executionRunId} does not exist`);
    }
    if (String(run.controlThreadId) !== args.controlThreadId) {
      throw new Error(
        `Execution run ${args.executionRunId} does not belong to control thread ${args.controlThreadId}`,
      );
    }

    const occurredAtMs = Date.parse(args.occurredAt);
    const nextStatus = deriveNextStatus(args.type);

    const transition = canApplyLifecycleEvent({
      currentStatus: run.status as ExecutionRunStatus,
      incomingType: args.type,
    });
    if (!transition.allowed) {
      return {
        applied: false,
        status: run.status as ExecutionRunStatus,
      };
    }

    await ctx.db.insert("executionRunEvents", {
      eventId: args.eventId,
      executionRunId: args.executionRunId,
      controlThreadId: run.controlThreadId,
      type: args.type,
      payloadJson: JSON.stringify(args),
      createdAt: occurredAtMs,
    });

    // Event ids are the idempotency key. Once we've recorded one, retries can safely no-op.
    await ctx.db.patch(run._id, {
      status: nextStatus,
      updatedAt: occurredAtMs,
      lastEventId: args.eventId,
      ...(args.t3ThreadId !== undefined ? { t3ThreadId: args.t3ThreadId } : {}),
      ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
      ...(args.failureSummary !== undefined ? { failureSummary: args.failureSummary } : {}),
      ...(args.type === "started" ? { startedAt: occurredAtMs } : {}),
      ...(args.type === "completed" || args.type === "failed" || args.type === "interrupted"
        ? { completedAt: occurredAtMs }
        : {}),
    });

    return {
      applied: true,
      status: nextStatus,
    };
  },
});

export const startSingleWorkerRun = internalAction({
  args: {
    controlThreadId: v.id("controlThreads"),
    initialPrompt: v.string(),
    workspaceRoot: v.string(),
    title: v.optional(v.string()),
    modelSelectionJson: v.optional(v.string()),
    runtimeMode: v.optional(
      v.union(
        v.literal("approval-required"),
        v.literal("auto-accept-edits"),
        v.literal("full-access"),
      ),
    ),
    interactionMode: v.optional(v.union(v.literal("default"), v.literal("plan"))),
  },
  returns: v.object({
    controlThreadId: v.string(),
    executionRunId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.string(),
  }),
  handler: async (ctx, args) => {
    const executionRunId = crypto.randomUUID();
    const requestedAt = Date.now();
    const runtimeMode: RuntimeMode = args.runtimeMode ?? "full-access";
    const interactionMode: ProviderInteractionMode = args.interactionMode ?? "default";
    const request: ExecutionRunCreateRequest = {
      controlThreadId: String(args.controlThreadId),
      executionRunId,
      initialPrompt: args.initialPrompt,
      workspaceRoot: args.workspaceRoot,
      runtimeMode,
      interactionMode,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.modelSelectionJson !== undefined
        ? { modelSelection: JSON.parse(args.modelSelectionJson) as ModelSelection }
        : {}),
    };

    await ctx.runMutation(internal.executionRuns.createRequestedRun, {
      controlThreadId: args.controlThreadId,
      executionRunId,
      initialPrompt: args.initialPrompt,
      workspaceRoot: args.workspaceRoot,
      runtimeMode,
      interactionMode,
      requestedAt,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.modelSelectionJson !== undefined
        ? { modelSelectionJson: args.modelSelectionJson }
        : {}),
    });

    const client = createT3ExecutionBridgeClient();
    const accepted = await client.createExecutionRun(request);
    await ctx.runMutation(internal.executionRuns.attachT3Acceptance, {
      executionRunId,
      t3ThreadId: accepted.t3ThreadId,
      acceptedAt: Date.parse(accepted.acceptedAt),
    });
    return accepted;
  },
});

export const recordLinearReplyPosted = internalMutation({
  args: {
    executionRunId: v.string(),
    replyCommentId: v.string(),
    postedAt: v.number(),
    bodyPreview: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      throw new Error(`Execution run ${args.executionRunId} does not exist`);
    }

    await ctx.db.patch(run._id, {
      linearReplyCommentId: args.replyCommentId,
      linearReplyPostedAt: args.postedAt,
      updatedAt: args.postedAt,
    });

    const existingMessage = await ctx.db
      .query("controlThreadMessages")
      .withIndex("by_external_message_key", (query: any) =>
        query.eq("externalMessageKey", args.replyCommentId),
      )
      .unique();
    if (existingMessage === null) {
      await ctx.db.insert("controlThreadMessages", {
        controlThreadId: run.controlThreadId,
        externalMessageKey: args.replyCommentId,
        authorName: process.env.LINEAR_BOT_USERNAME?.trim() || "Linear bot",
        bodyPreview: args.bodyPreview,
        createdAt: args.postedAt,
        updatedAt: args.postedAt,
      });
      return null;
    }

    await ctx.db.patch(existingMessage._id, {
      updatedAt: args.postedAt,
      authorName: process.env.LINEAR_BOT_USERNAME?.trim() || "Linear bot",
      bodyPreview: args.bodyPreview,
    });
    return null;
  },
});

export const recordLinearReplyError = internalMutation({
  args: {
    executionRunId: v.string(),
    errorMessage: v.string(),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      return null;
    }

    await ctx.db.patch(run._id, {
      linearReplyError: args.errorMessage,
      updatedAt: args.updatedAt,
    });
    return null;
  },
});

export const getExecutionRun = internalQuery({
  args: {
    executionRunId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      executionRunId: v.string(),
      controlThreadId: v.id("controlThreads"),
      status: executionRunStateForReturns(),
      t3ThreadId: v.optional(v.string()),
      t3TurnId: v.optional(v.string()),
      failureSummary: v.optional(v.string()),
      linearReplyCommentId: v.optional(v.string()),
      linearReplyError: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      return null;
    }

    return {
      executionRunId: run.executionRunId,
      controlThreadId: run.controlThreadId,
      status: run.status,
      ...(run.t3ThreadId !== undefined ? { t3ThreadId: run.t3ThreadId } : {}),
      ...(run.t3TurnId !== undefined ? { t3TurnId: run.t3TurnId } : {}),
      ...(run.failureSummary !== undefined ? { failureSummary: run.failureSummary } : {}),
      ...(run.linearReplyCommentId !== undefined
        ? { linearReplyCommentId: run.linearReplyCommentId }
        : {}),
      ...(run.linearReplyError !== undefined ? { linearReplyError: run.linearReplyError } : {}),
    };
  },
});

function executionRunStateForReturns() {
  return v.union(
    v.literal("requested"),
    v.literal("accepted"),
    v.literal("started"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("interrupted"),
    v.literal("reconciling"),
  );
}

export const findStaleRuns = internalQuery({
  args: {
    olderThanMs: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      executionRunId: v.string(),
      controlThreadId: v.id("controlThreads"),
      status: executionRunStateForReturns(),
      t3ThreadId: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const limit = args.limit ?? 20;
    const rows: any[] = await ctx.db
      .query("executionRuns")
      .withIndex("by_updated_at")
      .order("asc")
      .take(limit * 4);

    return rows
      .filter(
        (row: any) => !isTerminalStatus(row.status as ExecutionRunStatus) && row.updatedAt < cutoff,
      )
      .slice(0, limit)
      .map((row: any) => ({
        executionRunId: row.executionRunId,
        controlThreadId: row.controlThreadId,
        status: row.status,
        ...(row.t3ThreadId !== undefined ? { t3ThreadId: row.t3ThreadId } : {}),
        updatedAt: row.updatedAt,
      }));
  },
});

export const markReconciling = internalMutation({
  args: {
    executionRunId: v.string(),
  },
  returns: v.object({
    applied: v.boolean(),
    previousStatus: executionRunStateForReturns(),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      throw new Error(`Execution run ${args.executionRunId} does not exist`);
    }

    if (isTerminalStatus(run.status as ExecutionRunStatus)) {
      return { applied: false, previousStatus: run.status };
    }

    await ctx.db.patch(run._id, {
      status: "reconciling",
      updatedAt: Date.now(),
    });
    return { applied: true, previousStatus: run.status };
  },
});

export const resolveReconciliation = internalMutation({
  args: {
    executionRunId: v.string(),
    resolvedStatus: v.union(v.literal("completed"), v.literal("failed")),
    failureSummary: v.optional(v.string()),
  },
  returns: v.object({
    applied: v.boolean(),
    status: executionRunStateForReturns(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const run = await ctx.db
      .query("executionRuns")
      .withIndex("by_execution_run_id", (query: any) =>
        query.eq("executionRunId", args.executionRunId),
      )
      .unique();
    if (run === null) {
      throw new Error(`Execution run ${args.executionRunId} does not exist`);
    }

    if (isTerminalStatus(run.status as ExecutionRunStatus)) {
      return { applied: false, status: run.status };
    }

    await ctx.db.patch(run._id, {
      status: args.resolvedStatus,
      updatedAt: now,
      completedAt: now,
      ...(args.failureSummary !== undefined ? { failureSummary: args.failureSummary } : {}),
    });
    return { applied: true, status: args.resolvedStatus };
  },
});

const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000;

export const reconcileStaleRuns = internalAction({
  args: {
    olderThanMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      executionRunId: v.string(),
      resolved: v.boolean(),
      resolvedStatus: v.optional(v.string()),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const olderThanMs = args.olderThanMs ?? STALE_RUN_THRESHOLD_MS;
    const staleRuns = await ctx.runQuery(internal.executionRuns.findStaleRuns, {
      olderThanMs,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });

    if (staleRuns.length === 0) {
      return [];
    }

    const client = createT3ExecutionBridgeClient();
    const results: Array<{
      executionRunId: string;
      resolved: boolean;
      resolvedStatus?: string;
      reason: string;
    }> = [];

    for (const staleRun of staleRuns) {
      if (!staleRun.t3ThreadId) {
        const result = await ctx.runMutation(internal.executionRuns.resolveReconciliation, {
          executionRunId: staleRun.executionRunId,
          resolvedStatus: "failed",
          failureSummary: "Run never received T3 thread assignment and became stale.",
        });
        results.push({
          executionRunId: staleRun.executionRunId,
          resolved: result.applied,
          resolvedStatus: "failed",
          reason: "no_t3_thread",
        });
        continue;
      }

      try {
        const status = await client.queryRunStatus({
          executionRunId: staleRun.executionRunId,
          t3ThreadId: staleRun.t3ThreadId,
        });

        if (!status.found) {
          const result = await ctx.runMutation(internal.executionRuns.resolveReconciliation, {
            executionRunId: staleRun.executionRunId,
            resolvedStatus: "failed",
            failureSummary: "T3 has no record of this thread. Worker may have restarted.",
          });
          results.push({
            executionRunId: staleRun.executionRunId,
            resolved: result.applied,
            resolvedStatus: "failed",
            reason: "t3_thread_not_found",
          });
          continue;
        }

        const sessionStatus = status.sessionStatus;
        if (sessionStatus === "ready" || sessionStatus === "idle" || sessionStatus === "stopped") {
          const result = await ctx.runMutation(internal.executionRuns.resolveReconciliation, {
            executionRunId: staleRun.executionRunId,
            resolvedStatus: "completed",
          });
          results.push({
            executionRunId: staleRun.executionRunId,
            resolved: result.applied,
            resolvedStatus: "completed",
            reason: `t3_session_${sessionStatus}`,
          });
        } else if (sessionStatus === "error") {
          const result = await ctx.runMutation(internal.executionRuns.resolveReconciliation, {
            executionRunId: staleRun.executionRunId,
            resolvedStatus: "failed",
            failureSummary: status.lastError ?? "T3 session ended in error state.",
          });
          results.push({
            executionRunId: staleRun.executionRunId,
            resolved: result.applied,
            resolvedStatus: "failed",
            reason: "t3_session_error",
          });
        } else {
          await ctx.runMutation(internal.executionRuns.markReconciling, {
            executionRunId: staleRun.executionRunId,
          });
          results.push({
            executionRunId: staleRun.executionRunId,
            resolved: false,
            reason: `t3_session_still_${sessionStatus}`,
          });
        }
      } catch (error) {
        results.push({
          executionRunId: staleRun.executionRunId,
          resolved: false,
          reason: `poll_failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return results;
  },
});

export const continueWorkerRun = internalAction({
  args: {
    controlThreadId: v.id("controlThreads"),
    prompt: v.string(),
  },
  returns: v.object({
    executionRunId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.string(),
    newRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const runs: any[] = await ctx.runQuery(internal.executionRuns.listRunsForControlThread, {
      controlThreadId: args.controlThreadId,
    });

    if (runs.length === 0) {
      throw new Error(
        `No execution runs found for control thread ${args.controlThreadId}. Use startSingleWorkerRun instead.`,
      );
    }

    const latestRun = runs[0]!;
    const client = createT3ExecutionBridgeClient();

    if (!latestRun.t3ThreadId) {
      throw new Error(
        `Latest execution run ${latestRun.executionRunId} has no t3ThreadId. Cannot continue.`,
      );
    }

    const isActive =
      latestRun.status === "started" ||
      latestRun.status === "accepted" ||
      latestRun.status === "requested";

    if (isActive) {
      const request: ExecutionRunContinueRequest = {
        controlThreadId: String(args.controlThreadId),
        executionRunId: latestRun.executionRunId,
        t3ThreadId: latestRun.t3ThreadId,
        prompt: args.prompt,
        runtimeMode: latestRun.runtimeMode ?? "full-access",
        interactionMode: latestRun.interactionMode ?? "default",
      };
      const accepted = await client.continueExecutionRun(request);
      return {
        executionRunId: latestRun.executionRunId,
        t3ThreadId: accepted.t3ThreadId,
        acceptedAt: accepted.acceptedAt,
        newRun: false,
      };
    }

    const executionRunId = crypto.randomUUID();
    const requestedAt = Date.now();
    const runtimeMode: RuntimeMode = latestRun.runtimeMode ?? "full-access";
    const interactionMode: ProviderInteractionMode = latestRun.interactionMode ?? "default";

    await ctx.runMutation(internal.executionRuns.createRequestedRun, {
      controlThreadId: args.controlThreadId,
      executionRunId,
      initialPrompt: args.prompt,
      workspaceRoot: latestRun.workspaceRoot,
      runtimeMode,
      interactionMode,
      requestedAt,
    });

    const request: ExecutionRunContinueRequest = {
      controlThreadId: String(args.controlThreadId),
      executionRunId,
      t3ThreadId: latestRun.t3ThreadId,
      prompt: args.prompt,
      runtimeMode,
      interactionMode,
    };
    const accepted = await client.continueExecutionRun(request);

    await ctx.runMutation(internal.executionRuns.attachT3Acceptance, {
      executionRunId,
      t3ThreadId: accepted.t3ThreadId,
      acceptedAt: Date.parse(accepted.acceptedAt),
    });

    return {
      executionRunId,
      t3ThreadId: accepted.t3ThreadId,
      acceptedAt: accepted.acceptedAt,
      newRun: true,
    };
  },
});

export const interruptWorkerRun = internalAction({
  args: {
    controlThreadId: v.id("controlThreads"),
  },
  returns: v.object({
    executionRunId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.string(),
    interrupted: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const runs: any[] = await ctx.runQuery(internal.executionRuns.listRunsForControlThread, {
      controlThreadId: args.controlThreadId,
    });

    if (runs.length === 0) {
      return {
        executionRunId: "",
        t3ThreadId: "",
        acceptedAt: new Date().toISOString(),
        interrupted: false,
        reason: "no_runs",
      };
    }

    const latestRun = runs[0]!;
    const isActive =
      latestRun.status === "started" ||
      latestRun.status === "accepted" ||
      latestRun.status === "requested";

    if (!isActive) {
      return {
        executionRunId: latestRun.executionRunId,
        t3ThreadId: latestRun.t3ThreadId ?? "",
        acceptedAt: new Date().toISOString(),
        interrupted: false,
        reason: `run_already_${latestRun.status}`,
      };
    }

    if (!latestRun.t3ThreadId) {
      return {
        executionRunId: latestRun.executionRunId,
        t3ThreadId: "",
        acceptedAt: new Date().toISOString(),
        interrupted: false,
        reason: "no_t3_thread",
      };
    }

    const client = createT3ExecutionBridgeClient();
    const request: ExecutionRunInterruptRequest = {
      controlThreadId: String(args.controlThreadId),
      executionRunId: latestRun.executionRunId,
      t3ThreadId: latestRun.t3ThreadId,
    };

    const accepted = await client.interruptExecutionRun(request);
    return {
      executionRunId: latestRun.executionRunId,
      t3ThreadId: accepted.t3ThreadId,
      acceptedAt: accepted.acceptedAt,
      interrupted: true,
      reason: "interrupted",
    };
  },
});

export const listRunsForControlThread = internalQuery({
  args: {
    controlThreadId: v.id("controlThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      executionRunId: v.string(),
      controlThreadId: v.id("controlThreads"),
      status: executionRunStateForReturns(),
      t3ThreadId: v.optional(v.string()),
      workspaceRoot: v.string(),
      runtimeMode: v.string(),
      interactionMode: v.string(),
      requestedAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const rows: any[] = await ctx.db
      .query("executionRuns")
      .withIndex("by_control_thread_id", (query: any) =>
        query.eq("controlThreadId", args.controlThreadId),
      )
      .order("desc")
      .take(limit);

    return rows.map((row: any) => ({
      executionRunId: row.executionRunId,
      controlThreadId: row.controlThreadId,
      status: row.status,
      ...(row.t3ThreadId !== undefined ? { t3ThreadId: row.t3ThreadId } : {}),
      workspaceRoot: row.workspaceRoot,
      runtimeMode: row.runtimeMode,
      interactionMode: row.interactionMode,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
    }));
  },
});
