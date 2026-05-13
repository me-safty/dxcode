import { v } from "convex/values";
import * as DateTime from "effect/DateTime";

import { internalMutation, query } from "./_generated/server.js";

const lifecycleReplyStatus = v.union(v.literal("completed"), v.literal("failed"));
const lifecycleReplyLinkKind = v.union(v.literal("linear_issue"), v.literal("slack_thread"));

export interface TaskLifecycleReplyInput {
  readonly taskId: string;
  readonly status: "completed" | "failed";
  readonly workSessionId: string;
  readonly t3ThreadId?: string;
  readonly failureSummary?: string;
  readonly pullRequestUrl?: string;
  readonly assistantResponse?: string;
}

export function taskLifecycleReplyEventKey(input: {
  readonly workSessionId: string;
  readonly status: "completed" | "failed";
  readonly linkId: string;
  readonly t3TurnId?: string;
}) {
  if (input.t3TurnId !== undefined) {
    return `task-lifecycle-reply:${input.workSessionId}:${input.t3TurnId}:${input.status}:${input.linkId}`;
  }
  return `task-lifecycle-reply:${input.workSessionId}:${input.status}:${input.linkId}`;
}

export function taskAssistantMessageReplyEventKey(input: {
  readonly workSessionId: string;
  readonly t3MessageId: string;
  readonly linkId: string;
}) {
  return `task-assistant-message-reply:${input.workSessionId}:${input.t3MessageId}:${input.linkId}`;
}

export function taskPullRequestStatusReplyEventKey(input: {
  readonly workSessionId: string;
  readonly pullRequestExternalId: string;
  readonly linkId: string;
}) {
  return `task-pr-status-reply:${input.workSessionId}:${input.pullRequestExternalId}:${input.linkId}`;
}

export function taskStartedStatusReplyEventKey(input: {
  readonly taskId: string;
  readonly linkId: string;
}) {
  return `task-started-status-reply:${input.taskId}:${input.linkId}`;
}

export function githubDeploymentReadyReplyEventKey(input: {
  readonly taskId: string;
  readonly deploymentId: string;
  readonly url: string;
  readonly linkId: string;
}) {
  return `github-deployment-ready:${input.taskId}:${input.deploymentId}:${input.url}:${input.linkId}`;
}

export function githubPullRequestMergedNotificationEventKey(input: {
  readonly taskId: string;
  readonly pullRequestExternalId: string;
  readonly linkId: string;
}) {
  return `github-pr-merged:${input.taskId}:${input.pullRequestExternalId}:${input.linkId}`;
}

export function buildTaskPullRequestStatusReplyBody(input: {
  readonly pullRequestUrl: string;
  readonly previewUrl?: string;
  readonly deploymentPreviews?: ReadonlyArray<{
    readonly environment?: string;
    readonly url: string;
  }>;
}) {
  const previewLines =
    input.deploymentPreviews !== undefined && input.deploymentPreviews.length > 0
      ? input.deploymentPreviews.map((preview) =>
          preview.environment !== undefined
            ? `Preview (${preview.environment}): ${preview.url}`
            : `Preview: ${preview.url}`,
        )
      : input.previewUrl !== undefined
        ? [`Preview: ${input.previewUrl}`]
        : [];

  return [`Pull request: ${input.pullRequestUrl}`, ...previewLines].join("\n");
}

export function buildTaskLifecycleReplyBody(input: TaskLifecycleReplyInput) {
  if (input.status === "completed") {
    const assistantResponse = input.assistantResponse?.trim();
    if (assistantResponse) {
      return assistantResponse;
    }

    return [
      `Task ${input.taskId} completed.`,
      ...(input.t3ThreadId !== undefined ? [`Primary T3 thread: \`${input.t3ThreadId}\``] : []),
      ...(input.pullRequestUrl !== undefined ? [`Pull request: ${input.pullRequestUrl}`] : []),
      "Detailed output lives in T3 for this MVP.",
    ].join("\n");
  }

  return [
    `Task ${input.taskId} failed.`,
    ...(input.t3ThreadId !== undefined ? [`Primary T3 thread: \`${input.t3ThreadId}\``] : []),
    ...(input.pullRequestUrl !== undefined ? [`Pull request: ${input.pullRequestUrl}`] : []),
    `Failure summary: ${input.failureSummary?.trim() || "Unknown error"}`,
  ].join("\n");
}

function hasDeliveredAssistantMessageReply(input: {
  readonly taskEvents: Array<{
    readonly kind: string;
    readonly payloadJson?: string;
  }>;
  readonly workSessionId: string;
  readonly linkId: string;
}) {
  return input.taskEvents.some((event) => {
    if (event.kind !== "assistant-message-reply.delivered" || event.payloadJson === undefined) {
      return false;
    }

    try {
      const payload = JSON.parse(event.payloadJson) as {
        readonly workSessionId?: unknown;
        readonly linkId?: unknown;
      };
      return (
        String(payload.workSessionId) === input.workSessionId &&
        String(payload.linkId) === input.linkId
      );
    } catch {
      return false;
    }
  });
}

function taskEventReturn() {
  return v.object({
    id: v.id("taskEvents"),
    taskId: v.id("tasks"),
    eventKey: v.optional(v.string()),
    kind: v.string(),
    summary: v.string(),
    payloadJson: v.optional(v.string()),
    createdAt: v.number(),
  });
}

function toTaskEvent(row: any) {
  return {
    id: row._id,
    taskId: row.taskId,
    ...(row.eventKey !== undefined ? { eventKey: row.eventKey } : {}),
    kind: row.kind,
    summary: row.summary,
    ...(row.payloadJson !== undefined ? { payloadJson: row.payloadJson } : {}),
    createdAt: row.createdAt,
  };
}

export const appendTaskEvent = internalMutation({
  args: {
    taskId: v.id("tasks"),
    eventKey: v.optional(v.string()),
    kind: v.string(),
    summary: v.string(),
    payloadJson: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: taskEventReturn(),
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      ...(args.eventKey !== undefined ? { eventKey: args.eventKey } : {}),
      kind: args.kind,
      summary: args.summary,
      createdAt: args.createdAt ?? DateTime.toEpochMillis(DateTime.nowUnsafe()),
      ...(args.payloadJson !== undefined ? { payloadJson: args.payloadJson } : {}),
    });
    const event = await ctx.db.get(eventId);
    return toTaskEvent(event);
  },
});

export const claimTaskLifecycleReplies = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    status: lifecycleReplyStatus,
    occurredAt: v.string(),
    t3ThreadId: v.optional(v.string()),
    t3TurnId: v.optional(v.string()),
    failureSummary: v.optional(v.string()),
    assistantResponse: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      linkId: v.id("taskExternalLinks"),
      kind: lifecycleReplyLinkKind,
      externalId: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${args.workSessionId} does not exist`);
    }
    if (String(workSession.taskId) !== String(args.taskId)) {
      throw new Error(`Work Session ${args.workSessionId} does not belong to Task ${args.taskId}`);
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const pullRequestLink = links.find((candidate) => candidate.kind === "github_pr");
    const taskEvents =
      args.status === "completed"
        ? await ctx.db
            .query("taskEvents")
            .withIndex("by_task_created", (q: any) => q.eq("taskId", args.taskId))
            .collect()
        : [];
    const replyBody = buildTaskLifecycleReplyBody({
      taskId: String(args.taskId),
      workSessionId: String(args.workSessionId),
      status: args.status,
      ...(args.t3ThreadId !== undefined ? { t3ThreadId: args.t3ThreadId } : {}),
      ...(args.failureSummary !== undefined ? { failureSummary: args.failureSummary } : {}),
      ...(pullRequestLink?.url !== undefined ? { pullRequestUrl: pullRequestLink.url } : {}),
      ...(args.assistantResponse !== undefined
        ? { assistantResponse: args.assistantResponse }
        : workSession.assistantResponse !== undefined
          ? { assistantResponse: workSession.assistantResponse }
          : {}),
    });
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || (link.kind !== "linear_issue" && link.kind !== "slack_thread")) {
        continue;
      }
      if (
        args.status === "completed" &&
        hasDeliveredAssistantMessageReply({
          taskEvents,
          workSessionId: String(args.workSessionId),
          linkId: String(link._id),
        })
      ) {
        continue;
      }

      const claimEventKey = taskLifecycleReplyEventKey({
        workSessionId: String(args.workSessionId),
        status: args.status,
        linkId: String(link._id),
        ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "lifecycle-reply.claimed",
        summary: `Claimed ${args.status} reply for ${link.kind}.`,
        payloadJson: JSON.stringify({
          taskId: args.taskId,
          workSessionId: args.workSessionId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          status: args.status,
          occurredAt: args.occurredAt,
          ...(args.t3ThreadId !== undefined ? { t3ThreadId: args.t3ThreadId } : {}),
          ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        body: replyBody,
      });
    }

    return claimed;
  },
});

export const claimTaskPullRequestStatusReplies = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    pullRequestExternalId: v.string(),
    pullRequestUrl: v.string(),
    pullRequestStatus: v.optional(v.union(v.literal("created"), v.literal("existing"))),
    title: v.optional(v.string()),
    repo: v.optional(v.string()),
    headBranch: v.optional(v.string()),
    previewUrl: v.optional(v.string()),
    deploymentPreviewsJson: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      linkId: v.id("taskExternalLinks"),
      kind: lifecycleReplyLinkKind,
      externalId: v.string(),
      body: v.string(),
      pullRequestUrl: v.string(),
      pullRequestStatus: v.optional(v.union(v.literal("created"), v.literal("existing"))),
      title: v.optional(v.string()),
      repo: v.optional(v.string()),
      branch: v.optional(v.string()),
      t3ThreadId: v.optional(v.string()),
      environmentId: v.optional(v.string()),
      previewUrl: v.optional(v.string()),
      deploymentPreviews: v.optional(
        v.array(
          v.object({
            provider: v.optional(v.string()),
            environment: v.optional(v.string()),
            url: v.string(),
          }),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${args.workSessionId} does not exist`);
    }
    if (String(workSession.taskId) !== String(args.taskId)) {
      throw new Error(`Work Session ${args.workSessionId} does not belong to Task ${args.taskId}`);
    }
    const taskThread = await ctx.db.get(workSession.taskThreadId);
    if (taskThread === null) {
      throw new Error(`Task Thread ${workSession.taskThreadId} does not exist`);
    }
    const project = await ctx.db.get(task.projectId);
    if (project === null) {
      throw new Error(`Project ${task.projectId} does not exist`);
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const deploymentPreviews =
      args.deploymentPreviewsJson !== undefined
        ? (JSON.parse(args.deploymentPreviewsJson) as Array<{
            readonly provider?: string;
            readonly environment?: string;
            readonly url: string;
          }>)
        : undefined;
    const body = buildTaskPullRequestStatusReplyBody({
      pullRequestUrl: args.pullRequestUrl,
      ...(args.previewUrl !== undefined ? { previewUrl: args.previewUrl } : {}),
      ...(deploymentPreviews !== undefined ? { deploymentPreviews } : {}),
    });
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || (link.kind !== "linear_issue" && link.kind !== "slack_thread")) {
        continue;
      }

      const claimEventKey = taskPullRequestStatusReplyEventKey({
        workSessionId: String(args.workSessionId),
        pullRequestExternalId: args.pullRequestExternalId,
        linkId: String(link._id),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "pr-status-reply.claimed",
        summary: `Claimed pull request status reply for ${link.kind}.`,
        payloadJson: JSON.stringify({
          taskId: args.taskId,
          workSessionId: args.workSessionId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          pullRequestExternalId: args.pullRequestExternalId,
          pullRequestUrl: args.pullRequestUrl,
          ...(args.pullRequestStatus !== undefined
            ? { pullRequestStatus: args.pullRequestStatus }
            : {}),
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.repo !== undefined ? { repo: args.repo } : {}),
          ...(args.headBranch !== undefined ? { headBranch: args.headBranch } : {}),
          ...(args.previewUrl !== undefined ? { previewUrl: args.previewUrl } : {}),
          ...(deploymentPreviews !== undefined ? { deploymentPreviews } : {}),
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        body,
        pullRequestUrl: args.pullRequestUrl,
        ...(args.pullRequestStatus !== undefined
          ? { pullRequestStatus: args.pullRequestStatus }
          : {}),
        title: args.title ?? task.title,
        repo: args.repo ?? `${project.githubOwner}/${project.githubRepo}`,
        ...(args.headBranch !== undefined
          ? { branch: args.headBranch }
          : taskThread.branch !== undefined
            ? { branch: taskThread.branch }
            : {}),
        t3ThreadId: workSession.t3ThreadId,
        ...(workSession.environmentId !== undefined
          ? { environmentId: workSession.environmentId }
          : {}),
        ...(args.previewUrl !== undefined ? { previewUrl: args.previewUrl } : {}),
        ...(deploymentPreviews !== undefined ? { deploymentPreviews } : {}),
      });
    }

    return claimed;
  },
});

export const claimTaskStartedStatusReplies = internalMutation({
  args: {
    taskId: v.id("tasks"),
    t3ThreadId: v.string(),
    environmentId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      linkId: v.id("taskExternalLinks"),
      kind: v.literal("slack_thread"),
      externalId: v.string(),
      t3ThreadId: v.string(),
      environmentId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || link.kind !== "slack_thread") {
        continue;
      }

      const claimEventKey = taskStartedStatusReplyEventKey({
        taskId: String(args.taskId),
        linkId: String(link._id),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "task-started-status-reply.claimed",
        summary: "Claimed task started Slack status card.",
        payloadJson: JSON.stringify({
          taskId: args.taskId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          t3ThreadId: args.t3ThreadId,
          ...(args.environmentId !== undefined ? { environmentId: args.environmentId } : {}),
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        t3ThreadId: args.t3ThreadId,
        ...(args.environmentId !== undefined ? { environmentId: args.environmentId } : {}),
      });
    }

    return claimed;
  },
});

export const claimTaskAssistantMessageReplies = internalMutation({
  args: {
    eventId: v.string(),
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    occurredAt: v.string(),
    t3ThreadId: v.string(),
    t3MessageId: v.string(),
    t3TurnId: v.optional(v.string()),
    assistantMessage: v.string(),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      workSessionId: v.id("workSessions"),
      linkId: v.id("taskExternalLinks"),
      kind: lifecycleReplyLinkKind,
      externalId: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const workSession = await ctx.db.get(args.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${args.workSessionId} does not exist`);
    }
    if (String(workSession.taskId) !== String(args.taskId)) {
      throw new Error(`Work Session ${args.workSessionId} does not belong to Task ${args.taskId}`);
    }

    const body = args.assistantMessage.trim();
    if (!body) {
      return [];
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || (link.kind !== "linear_issue" && link.kind !== "slack_thread")) {
        continue;
      }

      const claimEventKey = taskAssistantMessageReplyEventKey({
        workSessionId: String(args.workSessionId),
        t3MessageId: args.t3MessageId,
        linkId: String(link._id),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "assistant-message-reply.claimed",
        summary: `Claimed assistant message reply for ${link.kind}.`,
        payloadJson: JSON.stringify({
          eventId: args.eventId,
          taskId: args.taskId,
          workSessionId: args.workSessionId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          occurredAt: args.occurredAt,
          t3ThreadId: args.t3ThreadId,
          t3MessageId: args.t3MessageId,
          ...(args.t3TurnId !== undefined ? { t3TurnId: args.t3TurnId } : {}),
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        workSessionId: args.workSessionId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        body,
      });
    }

    return claimed;
  },
});

export const claimGitHubDeploymentReadyReplies = internalMutation({
  args: {
    taskId: v.id("tasks"),
    deploymentId: v.string(),
    environment: v.optional(v.string()),
    url: v.string(),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      linkId: v.id("taskExternalLinks"),
      kind: lifecycleReplyLinkKind,
      externalId: v.string(),
      environment: v.optional(v.string()),
      url: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || (link.kind !== "linear_issue" && link.kind !== "slack_thread")) {
        continue;
      }

      const claimEventKey = githubDeploymentReadyReplyEventKey({
        taskId: String(args.taskId),
        deploymentId: args.deploymentId,
        url: args.url,
        linkId: String(link._id),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "github-deployment-ready-reply.claimed",
        summary: `Claimed GitHub deployment ready reply for ${link.kind}.`,
        payloadJson: JSON.stringify({
          taskId: args.taskId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          deploymentId: args.deploymentId,
          ...(args.environment !== undefined ? { environment: args.environment } : {}),
          url: args.url,
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        ...(args.environment !== undefined ? { environment: args.environment } : {}),
        url: args.url,
      });
    }

    return claimed;
  },
});

export const claimGitHubPullRequestMergedNotifications = internalMutation({
  args: {
    taskId: v.id("tasks"),
    pullRequestExternalId: v.string(),
    pullRequestUrl: v.string(),
  },
  returns: v.array(
    v.object({
      claimEventKey: v.string(),
      taskId: v.id("tasks"),
      linkId: v.id("taskExternalLinks"),
      kind: lifecycleReplyLinkKind,
      externalId: v.string(),
      pullRequestUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (task === null) {
      throw new Error(`Task ${args.taskId} does not exist`);
    }

    const links = await ctx.db
      .query("taskExternalLinks")
      .withIndex("by_task", (q: any) => q.eq("taskId", args.taskId))
      .collect();
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    const claimed = [];

    for (const link of links) {
      if (link.muted || (link.kind !== "linear_issue" && link.kind !== "slack_thread")) {
        continue;
      }

      const claimEventKey = githubPullRequestMergedNotificationEventKey({
        taskId: String(args.taskId),
        pullRequestExternalId: args.pullRequestExternalId,
        linkId: String(link._id),
      });
      const existingClaim = await ctx.db
        .query("taskEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", claimEventKey))
        .unique();
      if (existingClaim !== null) {
        continue;
      }

      await ctx.db.insert("taskEvents", {
        taskId: args.taskId,
        eventKey: claimEventKey,
        kind: "github-pr-merged-notification.claimed",
        summary: `Claimed GitHub PR merged notification for ${link.kind}.`,
        payloadJson: JSON.stringify({
          taskId: args.taskId,
          linkId: link._id,
          kind: link.kind,
          externalId: link.externalId,
          pullRequestExternalId: args.pullRequestExternalId,
          pullRequestUrl: args.pullRequestUrl,
        }),
        createdAt: now,
      });

      claimed.push({
        claimEventKey,
        taskId: args.taskId,
        linkId: link._id,
        kind: link.kind,
        externalId: link.externalId,
        pullRequestUrl: args.pullRequestUrl,
      });
    }

    return claimed;
  },
});

export const recordTaskLifecycleReplyDelivered = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    status: lifecycleReplyStatus,
    externalMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:delivered`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "lifecycle-reply.delivered",
      summary: `Delivered ${args.status} lifecycle reply.`,
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        ...(args.externalMessageId !== undefined
          ? { externalMessageId: args.externalMessageId }
          : {}),
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskPullRequestStatusReplyDelivered = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    externalMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:delivered`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "pr-status-reply.delivered",
      summary: "Delivered pull request status reply.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        ...(args.externalMessageId !== undefined
          ? { externalMessageId: args.externalMessageId }
          : {}),
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskStartedStatusReplyDelivered = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    externalMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:delivered`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "task-started-status-reply.delivered",
      summary: "Delivered task started Slack status card.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        ...(args.externalMessageId !== undefined
          ? { externalMessageId: args.externalMessageId }
          : {}),
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskAssistantMessageReplyDelivered = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    externalMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:delivered`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "assistant-message-reply.delivered",
      summary: "Delivered assistant message reply.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        workSessionId: args.workSessionId,
        linkId: args.linkId,
        ...(args.externalMessageId !== undefined
          ? { externalMessageId: args.externalMessageId }
          : {}),
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskLifecycleReplyFailed = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    status: lifecycleReplyStatus,
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:failed`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "lifecycle-reply.failed",
      summary: `Failed to deliver ${args.status} lifecycle reply.`,
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        error: args.error,
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskPullRequestStatusReplyFailed = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:failed`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "pr-status-reply.failed",
      summary: "Failed to deliver pull request status reply.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        error: args.error,
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskStartedStatusReplyFailed = internalMutation({
  args: {
    taskId: v.id("tasks"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:failed`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "task-started-status-reply.failed",
      summary: "Failed to deliver task started Slack status card.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        linkId: args.linkId,
        error: args.error,
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const recordTaskAssistantMessageReplyFailed = internalMutation({
  args: {
    taskId: v.id("tasks"),
    workSessionId: v.id("workSessions"),
    claimEventKey: v.string(),
    linkId: v.id("taskExternalLinks"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.claimEventKey}:failed`;
    const existingEvent = await ctx.db
      .query("taskEvents")
      .withIndex("by_event_key", (q: any) => q.eq("eventKey", eventKey))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    await ctx.db.insert("taskEvents", {
      taskId: args.taskId,
      eventKey,
      kind: "assistant-message-reply.failed",
      summary: "Failed to deliver assistant message reply.",
      payloadJson: JSON.stringify({
        claimEventKey: args.claimEventKey,
        workSessionId: args.workSessionId,
        linkId: args.linkId,
        error: args.error,
      }),
      createdAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });

    return null;
  },
});

export const listTaskEvents = query({
  args: {
    taskId: v.id("tasks"),
    limit: v.optional(v.number()),
  },
  returns: v.array(taskEventReturn()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_created", (q: any) => q.eq("taskId", args.taskId))
      .order("desc")
      .take(args.limit ?? 50);
    return rows.map(toTaskEvent);
  },
});
