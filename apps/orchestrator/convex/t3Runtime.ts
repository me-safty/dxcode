import { v } from "convex/values";
import { Schema } from "effect";
import { ThreadId } from "@t3tools/contracts";

import { createT3ExecutionBridgeClient } from "../src/t3/client.ts";
import { internal, api } from "./_generated/api.js";
import { action, internalMutation, internalQuery } from "./_generated/server.js";

export const materializeTaskRuntime = action({
  args: {
    taskId: v.id("tasks"),
    initialPrompt: v.string(),
    startCodingAgent: v.optional(v.boolean()),
  },
  returns: v.object({
    taskId: v.string(),
    workSessionId: v.string(),
    t3ProjectId: v.string(),
    t3ThreadId: v.string(),
    branch: v.union(v.null(), v.string()),
    worktreePath: v.union(v.null(), v.string()),
    acceptedAt: v.string(),
  }),
  handler: async (ctx, args) => {
    const tree = await ctx.runQuery(api.tasks.getTaskRuntimeSeed, {
      taskId: args.taskId,
    });
    if (tree === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const workSessionSeed = await ctx.runMutation(internal.t3Runtime.prepareWorkSessionSeed, {
      taskId: args.taskId,
      startCodingAgent: args.startCodingAgent ?? true,
    });

    const client = createT3ExecutionBridgeClient();
    const response = await client.materializeTaskRuntime({
      taskId: String(args.taskId),
      workSessionId: String(workSessionSeed.workSessionId),
      initialPrompt: args.initialPrompt,
      title: tree.task.title,
      runtimeMode: "full-access",
      interactionMode: "default",
      startCodingAgent: args.startCodingAgent ?? true,
      sandbox: {
        providerKind: "local",
      },
      services: [
        {
          kind: "t3-runtime",
          required: true,
        },
      ],
      idempotencyKey: `sandbox:local:${String(args.taskId)}:${String(workSessionSeed.workSessionId)}`,
      project: {
        repoName: tree.project.repoName,
        workspaceRoot: tree.project.sandboxWorkspaceRoot,
        defaultBranch: tree.project.defaultBranch,
      },
    });

    await ctx.runMutation(internal.t3Runtime.recordTaskRuntimeMaterialized, {
      taskId: args.taskId,
      taskThreadId: workSessionSeed.taskThreadId,
      workSessionId: workSessionSeed.workSessionId,
      t3ProjectId: String(response.t3ProjectId),
      t3ThreadId: String(response.t3ThreadId),
      acceptedAt: Date.parse(response.acceptedAt),
      ...(response.branch !== null ? { branch: response.branch } : {}),
      ...(response.worktreePath !== null ? { worktreePath: response.worktreePath } : {}),
    });

    await ctx.scheduler.runAfter(0, api.t3Runtime.ensureTaskPullRequest, {
      taskId: args.taskId,
      workSessionId: workSessionSeed.workSessionId,
      reason: "runtime-materialized",
    });

    return {
      taskId: response.taskId,
      workSessionId: response.workSessionId,
      t3ProjectId: String(response.t3ProjectId),
      t3ThreadId: String(response.t3ThreadId),
      branch: response.branch ?? null,
      worktreePath: response.worktreePath ?? null,
      acceptedAt: response.acceptedAt,
    };
  },
});

export const continueTaskRuntime = action({
  args: {
    eventId: v.string(),
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    t3ThreadId: v.string(),
    prompt: v.string(),
  },
  returns: v.object({
    taskId: v.string(),
    workSessionId: v.string(),
    t3ThreadId: v.string(),
    acceptedAt: v.string(),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.t3Runtime.validateTaskRuntimeContinuation, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
      t3ThreadId: args.t3ThreadId,
    });

    const client = createT3ExecutionBridgeClient();
    const t3ThreadId = Schema.decodeUnknownSync(ThreadId)(args.t3ThreadId);
    const response = await client.continueExecutionRun({
      controlThreadId: String(args.taskId),
      executionRunId: String(args.workSessionId),
      t3ThreadId,
      prompt: args.prompt,
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    await ctx.runMutation(internal.t3Runtime.recordTaskRuntimeContinuationAccepted, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
      t3ThreadId: String(response.t3ThreadId),
      eventKey: `${args.eventId}:runtime-continuation`,
      acceptedAt: Date.parse(response.acceptedAt),
    });

    await ctx.scheduler.runAfter(0, api.t3Runtime.ensureTaskPullRequest, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
      reason: "runtime-continuation",
    });

    return {
      taskId: String(args.taskId),
      workSessionId: String(response.executionRunId),
      t3ThreadId: String(response.t3ThreadId),
      acceptedAt: response.acceptedAt,
    };
  },
});

export const ensureTaskPullRequest = action({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(
      v.literal("waiting_for_changes"),
      v.literal("created"),
      v.literal("existing"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const seed = await ctx.runQuery(internal.t3Runtime.getTaskPullRequestSeed, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
    });
    if (seed === null) {
      return { status: "skipped" as const, summary: "Task runtime is not materialized yet." };
    }

    const idempotencyKey = `task-pr:${String(args.taskId)}:${String(args.workSessionId)}:${seed.branch}`;
    await ctx.runMutation(internal.t3Runtime.recordTaskPullRequestRequested, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
      eventKey: `${idempotencyKey}:requested`,
      reason: args.reason ?? "unspecified",
    });

    const client = createT3ExecutionBridgeClient();
    const response = await client.ensureTaskPullRequest({
      taskId: String(args.taskId),
      workSessionId: String(args.workSessionId),
      branch: seed.branch,
      worktreePath: seed.worktreePath,
      title: seed.title,
      idempotencyKey,
      project: {
        githubOwner: seed.project.githubOwner,
        githubRepo: seed.project.githubRepo,
        defaultBranch: seed.project.defaultBranch,
      },
    });

    await ctx.runMutation(internal.t3Runtime.recordTaskPullRequestEnsureResult, {
      taskId: args.taskId,
      workSessionId: args.workSessionId,
      eventKey: `${idempotencyKey}:${response.status}`,
      status: response.status,
      checkedAt: Date.parse(response.checkedAt),
      ...(response.summary !== undefined ? { summary: response.summary } : {}),
      ...(response.pullRequest !== undefined
        ? {
            owner: response.pullRequest.owner,
            repo: response.pullRequest.repo,
            number: response.pullRequest.number,
            url: response.pullRequest.url,
            headBranch: response.pullRequest.headBranch,
            baseBranch: response.pullRequest.baseBranch,
            title: response.pullRequest.title,
            draft: response.pullRequest.draft,
          }
        : {}),
    });

    return {
      status: response.status,
      ...(response.pullRequest !== undefined ? { url: response.pullRequest.url } : {}),
      ...(response.summary !== undefined ? { summary: response.summary } : {}),
    };
  },
});

export const getTaskPullRequestSeed = internalQuery({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      branch: v.string(),
      worktreePath: v.string(),
      project: v.object({
        githubOwner: v.string(),
        githubRepo: v.string(),
        defaultBranch: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      return null;
    }
    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null || String(workSession.taskId) !== String(args.taskId)) {
      return null;
    }
    const taskThread = await ctx.db.get(workSession.taskThreadId);
    const project = await ctx.db.get(task.projectId);
    if (
      taskThread?.branch === undefined ||
      taskThread.worktreePath === undefined ||
      project === null
    ) {
      return null;
    }

    return {
      title: task.title,
      branch: taskThread.branch,
      worktreePath: taskThread.worktreePath,
      project: {
        githubOwner: project.githubOwner,
        githubRepo: project.githubRepo,
        defaultBranch: project.defaultBranch,
      },
    };
  },
});

export const recordTaskPullRequestRequested = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    eventKey: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", args.eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey: args.eventKey,
      kind: "task-pr.requested",
      summary: "Task pull request ensure was requested.",
      payloadJson: JSON.stringify({
        workSessionId: args.workSessionId,
        reason: args.reason,
      }),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const recordTaskPullRequestEnsureResult = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    eventKey: v.string(),
    status: v.union(
      v.literal("waiting_for_changes"),
      v.literal("created"),
      v.literal("existing"),
      v.literal("failed"),
    ),
    checkedAt: v.number(),
    summary: v.optional(v.string()),
    owner: v.optional(v.string()),
    repo: v.optional(v.string()),
    number: v.optional(v.number()),
    url: v.optional(v.string()),
    headBranch: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    title: v.optional(v.string()),
    draft: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", args.eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    if (
      (args.status === "created" || args.status === "existing") &&
      args.owner !== undefined &&
      args.repo !== undefined &&
      args.number !== undefined &&
      args.url !== undefined
    ) {
      const externalId = `${args.owner}/${args.repo}#${args.number}`;
      const existingLink = await ctx.db
        .query("taskExternalLinks")
        .withIndex("by_kind_external_id", (q: any) =>
          q.eq("kind", "github_pr").eq("externalId", externalId),
        )
        .unique();
      if (existingLink !== null) {
        await ctx.db.patch(existingLink._id, {
          taskId: args.taskId,
          url: args.url,
          updatedAt: args.checkedAt,
        });
      } else {
        await ctx.db.insert("taskExternalLinks", {
          taskId: args.taskId,
          kind: "github_pr",
          externalId,
          url: args.url,
          muted: false,
          createdAt: args.checkedAt,
          updatedAt: args.checkedAt,
        });
      }
    }

    const eventKind =
      args.status === "waiting_for_changes"
        ? "task-pr.waiting-for-changes"
        : args.status === "failed"
          ? "task-pr.failed"
          : "task-pr.created";
    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey: args.eventKey,
      kind: eventKind,
      summary:
        args.summary ??
        (args.status === "waiting_for_changes"
          ? "Task pull request is waiting for changes."
          : args.status === "failed"
            ? "Task pull request ensure failed."
            : "Task pull request is available."),
      payloadJson: JSON.stringify({
        workSessionId: args.workSessionId,
        status: args.status,
        ...(args.url !== undefined ? { url: args.url } : {}),
        ...(args.number !== undefined ? { number: args.number } : {}),
        ...(args.headBranch !== undefined ? { headBranch: args.headBranch } : {}),
        ...(args.baseBranch !== undefined ? { baseBranch: args.baseBranch } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
      }),
      createdAt: args.checkedAt,
    });

    return null;
  },
});

export const validateTaskRuntimeContinuation = internalQuery({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    t3ThreadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${args.workSessionId} does not exist`);
    }
    if (String(workSession.taskId) !== String(args.taskId)) {
      throw new Error(`Work Session ${args.workSessionId} does not belong to Task ${args.taskId}`);
    }
    if (workSession.t3ThreadId !== args.t3ThreadId) {
      throw new Error(
        `Work Session ${args.workSessionId} is attached to T3 Thread ${workSession.t3ThreadId}, not ${args.t3ThreadId}`,
      );
    }
    return null;
  },
});

export const recordTaskRuntimeContinuationAccepted = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    t3ThreadId: v.string(),
    eventKey: v.string(),
    acceptedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workSessionId, {
      t3ThreadId: args.t3ThreadId,
      status: "accepted",
      updatedAt: args.acceptedAt,
    });
    await ctx.db.patch(args.taskId, {
      status: "working",
      updatedAt: args.acceptedAt,
    });
    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey: args.eventKey,
      kind: "runtime.continuation-accepted",
      summary: "T3 runtime continuation was accepted for the Task.",
      payloadJson: JSON.stringify({
        workSessionId: args.workSessionId,
        t3ThreadId: args.t3ThreadId,
      }),
      createdAt: args.acceptedAt,
    });
    return null;
  },
});

export const prepareWorkSessionSeed = internalMutation({
  args: { taskId: v.id("tasks"), startCodingAgent: v.boolean() },
  returns: v.object({
    taskThreadId: v.id("taskThreads"),
    workSessionId: v.id("workSessions"),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const now = Date.now();
    const taskThreadId = await ctx.db.insert("taskThreads", {
      taskId: args.taskId,
      t3ThreadId: `pending:${crypto.randomUUID()}`,
      role: "primary",
      createdAt: now,
      updatedAt: now,
    });

    const workSessionId = await ctx.db.insert("workSessions", {
      taskId: args.taskId,
      taskThreadId,
      t3ThreadId: `pending:${String(taskThreadId)}`,
      status: "requested",
      updatedAt: now,
      bridgeRunId: String(taskThreadId),
    });

    await ctx.db.patch(args.taskId, {
      currentPrimaryTaskThreadId: taskThreadId,
      status:
        task.status === "ready" ? (args.startCodingAgent ? "working" : "needs_input") : task.status,
      updatedAt: now,
    });

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      kind: "runtime.materialization-requested",
      summary: "T3 runtime materialization was requested.",
      payloadJson: JSON.stringify({ taskThreadId, workSessionId }),
      createdAt: now,
    });

    return { taskThreadId, workSessionId };
  },
});

export const recordTaskRuntimeMaterialized = internalMutation({
  args: {
    taskId: v.id("tasks"),
    taskThreadId: v.id("taskThreads"),
    workSessionId: v.id("workSessions"),
    t3ProjectId: v.string(),
    t3ThreadId: v.string(),
    branch: v.optional(v.string()),
    worktreePath: v.optional(v.string()),
    acceptedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskThreadId, {
      t3ProjectId: args.t3ProjectId,
      t3ThreadId: args.t3ThreadId,
      updatedAt: args.acceptedAt,
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
      ...(args.worktreePath !== undefined ? { worktreePath: args.worktreePath } : {}),
    });

    await ctx.db.patch(args.workSessionId, {
      t3ThreadId: args.t3ThreadId,
      status: "accepted",
      updatedAt: args.acceptedAt,
    });

    const task = await ctx.db.get(args.taskId);
    if (task !== null) {
      await ctx.db.patch(args.taskId, {
        currentPrimaryTaskThreadId: args.taskThreadId,
        updatedAt: args.acceptedAt,
      });
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      kind: "runtime.materialized",
      summary: "T3 runtime was materialized for the Task.",
      payloadJson: JSON.stringify({
        taskThreadId: args.taskThreadId,
        workSessionId: args.workSessionId,
        t3ProjectId: args.t3ProjectId,
        t3ThreadId: args.t3ThreadId,
        ...(args.branch !== undefined ? { branch: args.branch } : {}),
        ...(args.worktreePath !== undefined ? { worktreePath: args.worktreePath } : {}),
      }),
      createdAt: args.acceptedAt,
    });

    return null;
  },
});

export const applyTaskRuntimeLifecycleEvent = internalMutation({
  args: {
    eventId: v.string(),
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
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
    status: v.union(
      v.literal("requested"),
      v.literal("accepted"),
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("interrupted"),
      v.literal("superseded"),
    ),
  }),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", args.eventId))
      .unique();
    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${args.workSessionId} does not exist`);
    }
    if (String(workSession.taskId) !== String(args.taskId)) {
      throw new Error(`Work Session ${args.workSessionId} does not belong to Task ${args.taskId}`);
    }
    if (existingEvent !== null) {
      return { applied: false, status: workSession.status };
    }

    const occurredAtMs = Date.parse(args.occurredAt);
    const nextStatus = args.type;
    const ended =
      args.type === "completed" || args.type === "failed" || args.type === "interrupted";

    await ctx.db.patch(args.workSessionId, {
      status: nextStatus,
      updatedAt: occurredAtMs,
      ...(args.type === "started" && workSession.startedAt === undefined
        ? { startedAt: occurredAtMs }
        : {}),
      ...(ended ? { endedAt: occurredAtMs } : {}),
      ...(args.t3ThreadId !== undefined ? { t3ThreadId: args.t3ThreadId } : {}),
      ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
      ...(args.failureSummary !== undefined ? { failureSummary: args.failureSummary } : {}),
    });

    if (args.type === "failed") {
      await ctx.db.patch(args.taskId, {
        status: "failed",
        statusReason: args.failureSummary ?? "Coding Agent work failed.",
        updatedAt: occurredAtMs,
      });
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey: args.eventId,
      kind: `work-session.${args.type}`,
      summary: `Work Session ${args.type}.`,
      payloadJson: JSON.stringify({
        workSessionId: args.workSessionId,
        ...(args.t3ThreadId !== undefined ? { t3ThreadId: args.t3ThreadId } : {}),
        ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
        ...(args.failureSummary !== undefined ? { failureSummary: args.failureSummary } : {}),
      }),
      createdAt: occurredAtMs,
    });

    return { applied: true, status: nextStatus };
  },
});
