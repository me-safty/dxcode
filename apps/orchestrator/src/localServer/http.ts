import * as Schema from "effect/Schema";
import {
  TaskRuntimeAssistantMessageEvent,
  TaskRuntimeLifecycleEvent,
  TaskRuntimeUserInputRequestEvent,
} from "@t3tools/contracts";

import { chatSdkThreadIdForLifecycleReply } from "../taskIntake/lifecycleReplies.ts";
import { createTaskIntakeChatSdkBot } from "../taskIntake/chatSdk.ts";
import { createTaskIntakeChatSdkState } from "../taskIntake/convexChatSdkState.ts";
import { postableReplyBody } from "../taskIntake/postableReply.ts";
import { handleSlackWebhook } from "./slackWebhook.ts";
import { LocalTaskRuntime } from "./t3Runtime.ts";
import type { LocalOrchestratorConfig } from "./config.ts";
import { LocalOrchestratorStore, type UpsertProjectInput } from "./store.ts";

const decodeTaskRuntimeAssistantMessageEvent = Schema.decodeUnknownSync(
  TaskRuntimeAssistantMessageEvent,
);
const decodeTaskRuntimeLifecycleEvent = Schema.decodeUnknownSync(TaskRuntimeLifecycleEvent);
const decodeTaskRuntimeUserInputRequestEvent = Schema.decodeUnknownSync(
  TaskRuntimeUserInputRequestEvent,
);

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

function errorSummary(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function requireBridgeAuthorization(request: Request) {
  const secret = process.env.T3_EXECUTION_BRIDGE_SHARED_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 503,
      message: "Missing orchestrator bridge secret",
    };
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return {
      ok: false as const,
      status: 401,
      message: "Unauthorized execution bridge callback",
    };
  }

  return { ok: true as const };
}

function validateProjectInput(input: unknown): UpsertProjectInput {
  if (input === null || typeof input !== "object") {
    throw new Error("Project payload must be an object");
  }
  const record = input as Record<string, unknown>;
  const required = ["repoName", "defaultBranch", "githubOwner", "githubRepo"] as const;
  for (const key of required) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) {
      throw new Error(`Missing project field: ${key}`);
    }
  }
  return {
    repoName: (record.repoName as string).trim(),
    defaultBranch: (record.defaultBranch as string).trim(),
    githubOwner: (record.githubOwner as string).trim(),
    githubRepo: (record.githubRepo as string).trim(),
    ...(typeof record.workspaceRoot === "string" && record.workspaceRoot.trim().length > 0
      ? { workspaceRoot: record.workspaceRoot.trim() }
      : {}),
    ...(typeof record.linearTeamId === "string" && record.linearTeamId.trim().length > 0
      ? { linearTeamId: record.linearTeamId.trim() }
      : {}),
    ...(typeof record.linearProjectId === "string" && record.linearProjectId.trim().length > 0
      ? { linearProjectId: record.linearProjectId.trim() }
      : {}),
    ...(typeof record.t3ProjectId === "string" && record.t3ProjectId.trim().length > 0
      ? { t3ProjectId: record.t3ProjectId.trim() }
      : {}),
  };
}

async function postLifecycleReply(input: {
  readonly config: LocalOrchestratorConfig;
  readonly store: LocalOrchestratorStore;
  readonly taskId: string;
  readonly workSessionId: string;
  readonly status: "completed" | "failed";
  readonly eventId: string;
  readonly body: string;
}) {
  const link = input.store.findPrimarySlackLink(input.taskId);
  if (link === null || link.muted === 1) {
    return { posted: false, reason: link === null ? "no_slack_link" : "slack_link_muted" };
  }

  const claimEventKey = `${input.eventId}:local-lifecycle-reply:${link.id}`;
  const claimed = input.store.claimTaskReply(
    claimEventKey,
    input.taskId,
    `task-intake.reply.${input.status}`,
    `Task Intake ${input.status} reply was posted.`,
    {
      workSessionId: input.workSessionId,
      externalId: link.externalId,
    },
  );
  if (!claimed) {
    return { posted: false, reason: "already_claimed" };
  }

  const bot = createTaskIntakeChatSdkBot({
    sources: new Set(["slack"]),
    state: createTaskIntakeChatSdkState(input.store.getChatSdkStateOps()),
    async onMessage() {},
  });
  await bot.initialize();
  const posted = await bot
    .thread(
      chatSdkThreadIdForLifecycleReply({
        kind: "slack_thread",
        externalId: link.externalId,
      }),
    )
    .post(postableReplyBody({ kind: "slack_thread", body: input.body }));
  return { posted: true, externalMessageId: posted.id };
}

export function createLocalOrchestratorFetchHandler(input: {
  readonly config: LocalOrchestratorConfig;
  readonly store: LocalOrchestratorStore;
  readonly runtime: LocalTaskRuntime;
}) {
  return async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return new Response("ok", { status: 200 });
      }

      if (request.method === "GET" && url.pathname === "/projects") {
        return json({ projects: input.store.listProjects() });
      }

      if (request.method === "POST" && url.pathname === "/projects/upsert") {
        const project = input.store.upsertProject(validateProjectInput(await request.json()));
        return json(project);
      }

      if (request.method === "POST" && url.pathname === "/slack/webhook") {
        return await handleSlackWebhook({ ...input, request });
      }

      if (request.method === "POST" && url.pathname === "/t3/task-runtime-events") {
        const auth = requireBridgeAuthorization(request);
        if (!auth.ok) return json({ error: auth.message }, { status: auth.status });

        const payload = decodeTaskRuntimeLifecycleEvent(await request.json());
        const result = input.store.applyTaskRuntimeLifecycleEvent({
          eventId: payload.eventId,
          taskId: payload.taskId,
          workSessionId: payload.workSessionId,
          type: payload.type,
          occurredAt: payload.occurredAt,
          ...(payload.t3ThreadId !== undefined ? { t3ThreadId: String(payload.t3ThreadId) } : {}),
          ...(payload.t3TurnId !== undefined ? { t3TurnId: String(payload.t3TurnId) } : {}),
          ...(payload.failureSummary !== undefined
            ? { failureSummary: payload.failureSummary }
            : {}),
          ...(payload.assistantResponse !== undefined
            ? { assistantResponse: payload.assistantResponse }
            : {}),
        });
        if (payload.assistantResponse !== undefined) {
          input.store.recordTaskPullRequestsFromAssistantMessage({
            taskId: payload.taskId,
            sourceEventId: payload.eventId,
            assistantMessage: payload.assistantResponse,
            observedAt: Date.now(),
          });
        }

        let intakeReply:
          | {
              readonly posted: boolean;
              readonly reason?: string;
              readonly externalMessageId?: string;
            }
          | undefined;
        if (payload.type === "completed" || payload.type === "failed") {
          const body =
            payload.type === "completed"
              ? (payload.assistantResponse ?? "Task runtime completed.")
              : `Task runtime failed.${payload.failureSummary === undefined ? "" : `\n\n${payload.failureSummary}`}`;
          intakeReply = await postLifecycleReply({
            ...input,
            taskId: payload.taskId,
            workSessionId: payload.workSessionId,
            status: payload.type,
            eventId: payload.eventId,
            body,
          }).catch((error) => ({
            posted: false,
            reason: errorSummary(error),
          }));
        }

        return json({
          accepted: true,
          ...result,
          ...(intakeReply !== undefined ? { intakeReply } : {}),
        });
      }

      if (request.method === "POST" && url.pathname === "/t3/task-runtime-assistant-messages") {
        const auth = requireBridgeAuthorization(request);
        if (!auth.ok) return json({ error: auth.message }, { status: auth.status });

        const payload = decodeTaskRuntimeAssistantMessageEvent(await request.json());
        const recorded = input.store.recordTaskPullRequestsFromAssistantMessage({
          taskId: payload.taskId,
          sourceEventId: payload.eventId,
          assistantMessage: payload.assistantMessage,
          observedAt: Date.now(),
        });
        return json({ accepted: true, ...recorded });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/t3/task-runtime-assistant-message-observations"
      ) {
        const auth = requireBridgeAuthorization(request);
        if (!auth.ok) return json({ error: auth.message }, { status: auth.status });

        const payload = decodeTaskRuntimeAssistantMessageEvent(await request.json());
        const recorded = input.store.recordTaskPullRequestsFromAssistantMessage({
          taskId: payload.taskId,
          sourceEventId: payload.eventId,
          assistantMessage: payload.assistantMessage,
          observedAt: Date.now(),
        });
        return json({ accepted: true, ...recorded });
      }

      if (request.method === "POST" && url.pathname === "/t3/task-runtime-user-input-requests") {
        const auth = requireBridgeAuthorization(request);
        if (!auth.ok) return json({ error: auth.message }, { status: auth.status });

        const payload = decodeTaskRuntimeUserInputRequestEvent(await request.json());
        input.store.claimTaskReply(
          payload.eventId,
          payload.taskId,
          "runtime.user-input-requested",
          "Provider requested user input.",
          {
            workSessionId: payload.workSessionId,
            t3ThreadId: payload.t3ThreadId,
            requestId: payload.requestId,
            questions: payload.questions,
          },
        );
        return json({ accepted: true });
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      input.store.appendOrchestratorEvent({
        kind: "local.http.request-failed",
        source: "local",
        severity: "error",
        summary: "Local orchestrator request failed.",
        payload: {
          method: request.method,
          path: url.pathname,
          error: errorSummary(error),
        },
      });
      return json({ error: errorSummary(error) }, { status: 500 });
    }
  };
}
