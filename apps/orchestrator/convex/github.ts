"use node";

import { v } from "convex/values";

import {
  githubPullRequestExternalId,
  parseGitHubDeploymentReadyEvent,
  parseGitHubPullRequestMergedEvent,
  toVercelBranchDeploymentUrl,
} from "../src/github/webhook.ts";
import { createTaskIntakeChatSdkBot } from "../src/taskIntake/chatSdk.ts";
import { createConvexChatSdkState } from "../src/taskIntake/convexChatSdkState.ts";
import { chatSdkThreadIdForLifecycleReply } from "../src/taskIntake/lifecycleReplies.ts";
import {
  postableDeploymentReady,
  postablePullRequestStatus,
} from "../src/taskIntake/postableReply.ts";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";

function errorSummary(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function chatSdkState(ctx: any) {
  return createConvexChatSdkState({
    subscribe(threadId) {
      return ctx.runMutation(internal.chatSdkState.subscribe, { threadId });
    },
    unsubscribe(threadId) {
      return ctx.runMutation(internal.chatSdkState.unsubscribe, { threadId });
    },
    isSubscribed(threadId) {
      return ctx.runMutation(internal.chatSdkState.isSubscribed, { threadId });
    },
    acquireLock(input) {
      return ctx.runMutation(internal.chatSdkState.acquireLock, input);
    },
    releaseLock(lock) {
      return ctx.runMutation(internal.chatSdkState.releaseLock, {
        threadId: lock.threadId,
        token: lock.token,
      });
    },
    forceReleaseLock(threadId) {
      return ctx.runMutation(internal.chatSdkState.forceReleaseLock, { threadId });
    },
    extendLock(input) {
      return ctx.runMutation(internal.chatSdkState.extendLock, {
        threadId: input.lock.threadId,
        token: input.lock.token,
        ttlMs: input.ttlMs,
      });
    },
    get(key) {
      return ctx.runMutation(internal.chatSdkState.get, { key });
    },
    set(input) {
      return ctx.runMutation(internal.chatSdkState.set, input);
    },
    setIfNotExists(input) {
      return ctx.runMutation(internal.chatSdkState.setIfNotExists, input);
    },
    delete(key) {
      return ctx.runMutation(internal.chatSdkState.deleteKey, { key });
    },
    appendToList(input) {
      return ctx.runMutation(internal.chatSdkState.appendToList, input);
    },
    getList(key) {
      return ctx.runMutation(internal.chatSdkState.getList, { key });
    },
    enqueue(input) {
      return ctx.runMutation(internal.chatSdkState.enqueue, input);
    },
    dequeue(threadId) {
      return ctx.runMutation(internal.chatSdkState.dequeue, { threadId });
    },
    queueDepth(threadId) {
      return ctx.runMutation(internal.chatSdkState.queueDepth, { threadId });
    },
  });
}

export const handleWebhook = internalAction({
  args: {
    event: v.string(),
    deliveryId: v.string(),
    body: v.string(),
  },
  returns: v.object({
    handled: v.boolean(),
    reason: v.optional(v.string()),
    delivered: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    let payload: unknown;
    try {
      payload = JSON.parse(args.body);
    } catch {
      return { handled: false, reason: "invalid_json" };
    }

    if (args.event === "deployment_status") {
      const event = parseGitHubDeploymentReadyEvent(payload);
      if (event === null) {
        return { handled: false, reason: "unsupported_deployment_status" };
      }

      const pullRequests = await ctx.runQuery(internal.githubData.findPullRequestsByHeadSha, {
        owner: event.owner,
        repo: event.repo,
        headSha: event.headSha,
      });
      if (pullRequests.length === 0) {
        return { handled: false, reason: "no_linked_pull_request_for_head_sha" };
      }

      const bot = createTaskIntakeChatSdkBot({
        sources: new Set(["slack"]),
        state: chatSdkState(ctx),
        async onMessage() {},
      });
      await bot.initialize();

      let delivered = 0;
      for (const pullRequest of pullRequests) {
        const claims = await ctx.runMutation(
          internal.taskEvents.claimGitHubDeploymentReadyReplies,
          {
            taskId: pullRequest.taskId,
            deploymentId: `${event.deploymentId}:${event.statusId ?? args.deliveryId}`,
            ...(event.environment !== undefined ? { environment: event.environment } : {}),
            url: toVercelBranchDeploymentUrl({
              url: event.url,
              ...(event.environment !== undefined ? { environment: event.environment } : {}),
              ...(pullRequest.headBranch !== undefined ? { branch: pullRequest.headBranch } : {}),
            }),
          },
        );

        for (const claim of claims.filter((claim) => claim.kind === "slack_thread")) {
          try {
            const posted: { readonly id: string } = await bot
              .thread(
                chatSdkThreadIdForLifecycleReply({
                  kind: claim.kind,
                  externalId: claim.externalId,
                }),
              )
              .post(
                postableDeploymentReady({
                  kind: claim.kind,
                  ...(claim.environment !== undefined ? { environment: claim.environment } : {}),
                  url: claim.url,
                }),
              );
            delivered += 1;
            await ctx.runMutation(internal.taskEvents.appendTaskEvent, {
              taskId: claim.taskId,
              eventKey: `${claim.claimEventKey}:delivered`,
              kind: "github-deployment-ready-reply.delivered",
              summary: "Delivered GitHub deployment ready reply.",
              payloadJson: JSON.stringify({
                claimEventKey: claim.claimEventKey,
                linkId: claim.linkId,
                externalMessageId: posted.id,
              }),
            });
          } catch (error) {
            await ctx.runMutation(internal.taskEvents.appendTaskEvent, {
              taskId: claim.taskId,
              eventKey: `${claim.claimEventKey}:failed`,
              kind: "github-deployment-ready-reply.failed",
              summary: "Failed to deliver GitHub deployment ready reply.",
              payloadJson: JSON.stringify({
                claimEventKey: claim.claimEventKey,
                linkId: claim.linkId,
                error: errorSummary(error),
              }),
            });
          }
        }
      }

      return { handled: true, delivered };
    }

    if (args.event === "pull_request") {
      const event = parseGitHubPullRequestMergedEvent(payload);
      if (event === null) {
        return { handled: false, reason: "unsupported_pull_request_event" };
      }

      const externalId = githubPullRequestExternalId(event);
      const pullRequest = await ctx.runQuery(internal.githubData.findPullRequestByExternalId, {
        externalId,
      });
      if (pullRequest === null) {
        return { handled: false, reason: "no_linked_pull_request" };
      }

      await ctx.runMutation(internal.githubData.recordPullRequestMerged, {
        externalId,
        ...(event.mergedAt !== undefined ? { mergedAt: Date.parse(event.mergedAt) } : {}),
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.headSha !== undefined ? { headSha: event.headSha } : {}),
        ...(event.headBranch !== undefined ? { headBranch: event.headBranch } : {}),
      });

      const claims = await ctx.runMutation(
        internal.taskEvents.claimGitHubPullRequestMergedNotifications,
        {
          taskId: pullRequest.taskId,
          pullRequestExternalId: externalId,
          pullRequestUrl: event.url,
        },
      );
      const bot = createTaskIntakeChatSdkBot({
        sources: new Set(["slack"]),
        state: chatSdkState(ctx),
        async onMessage() {},
      });
      await bot.initialize();

      let delivered = 0;
      for (const claim of claims) {
        try {
          let externalMessageId: string | undefined;
          if (claim.kind === "slack_thread") {
            const threadId = chatSdkThreadIdForLifecycleReply({
              kind: claim.kind,
              externalId: claim.externalId,
            });
            const thread = bot.thread(threadId);
            const messageId = claim.externalId.split(":").at(-1);
            if (messageId === undefined) {
              throw new Error(`Invalid Slack thread external id: ${claim.externalId}`);
            }
            await thread.adapter.addReaction(threadId, messageId, "white_check_mark");
            const posted: { readonly id: string } = await thread.post(
              postablePullRequestStatus({
                kind: claim.kind,
                body: `Pull request merged: ${claim.pullRequestUrl}`,
                pullRequestUrl: claim.pullRequestUrl,
                pullRequestStatus: "existing",
                ...(event.title !== undefined ? { title: event.title } : {}),
                repo: `${event.owner}/${event.repo}`,
                ...(event.headBranch !== undefined ? { branch: event.headBranch } : {}),
              }),
            );
            externalMessageId = `${messageId}:reaction:white_check_mark;${posted.id}`;
          }
          delivered += 1;
          await ctx.runMutation(internal.taskEvents.appendTaskEvent, {
            taskId: claim.taskId,
            eventKey: `${claim.claimEventKey}:delivered`,
            kind: "github-pr-merged-notification.delivered",
            summary: "Delivered GitHub PR merged notification.",
            payloadJson: JSON.stringify({
              claimEventKey: claim.claimEventKey,
              linkId: claim.linkId,
              ...(externalMessageId !== undefined ? { externalMessageId } : {}),
            }),
          });
        } catch (error) {
          await ctx.runMutation(internal.taskEvents.appendTaskEvent, {
            taskId: claim.taskId,
            eventKey: `${claim.claimEventKey}:failed`,
            kind: "github-pr-merged-notification.failed",
            summary: "Failed to deliver GitHub PR merged notification.",
            payloadJson: JSON.stringify({
              claimEventKey: claim.claimEventKey,
              linkId: claim.linkId,
              error: errorSummary(error),
            }),
          });
        }
      }

      return { handled: true, delivered };
    }

    if (args.event === "ping") {
      return { handled: true, reason: "ping", delivered: 0 };
    }

    return { handled: false, reason: "unsupported_event" };
  },
});
