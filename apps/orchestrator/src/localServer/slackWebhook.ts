import { createTaskIntakeChatSdkBot } from "../taskIntake/chatSdk.ts";
import { createTaskIntakeChatSdkState } from "../taskIntake/convexChatSdkState.ts";
import { handleTaskIntakeMessage } from "../taskIntake/ingress.ts";
import { buildT3ThreadUrl, postableTaskStartedStatus } from "../taskIntake/postableReply.ts";
import { LocalTaskRuntime } from "./t3Runtime.ts";
import type { LocalOrchestratorConfig } from "./config.ts";
import { LocalOrchestratorStore } from "./store.ts";

export async function handleSlackWebhook(input: {
  readonly request: Request;
  readonly config: LocalOrchestratorConfig;
  readonly store: LocalOrchestratorStore;
  readonly runtime: LocalTaskRuntime;
}) {
  const bot = createTaskIntakeChatSdkBot({
    sources: new Set(["slack"]),
    state: createTaskIntakeChatSdkState(input.store.getChatSdkStateOps()),
    onAttachmentFetchFailure(failure) {
      input.store.appendOrchestratorEvent({
        kind: "slack.attachment.fetch-failed",
        source: "slack",
        severity: "warn",
        summary: "Slack image attachment could not be fetched as native bytes.",
        eventKey: `slack:attachment-fetch-failed:${crypto.randomUUID()}`,
        payload: failure,
      });
    },
    async onMessage({ thread, message, intakeMessage }) {
      await handleTaskIntakeMessage(intakeMessage, {
        store: {
          resolveMessage: async (storeInput) => input.store.resolveTaskIntakeMessage(storeInput),
          recordStartFailed: async (storeInput) => input.store.recordStartFailed(storeInput),
        },
        runtime: {
          materializeTaskRuntime: (runtimeInput) =>
            input.runtime.materializeTaskRuntime(runtimeInput),
          continueTaskRuntime: (runtimeInput) => input.runtime.continueTaskRuntime(runtimeInput),
        },
        replies: {
          async acknowledgeAccepted() {
            await thread.createSentMessageFromMessage(message).addReaction("eyes");
            return {
              status: "posted",
              externalMessageId: `${message.id}:reaction:eyes`,
            };
          },
          async postTaskStartedCard({ materialization }) {
            const posted = await thread.post(
              postableTaskStartedStatus({
                kind: "slack_thread",
                t3ThreadUrl: buildT3ThreadUrl({
                  baseUrl: input.config.t3WebAppBaseUrl,
                  environmentId: materialization.environmentId,
                  t3ThreadId: materialization.t3ThreadId,
                }),
              }),
            );
            return { status: "posted", externalMessageId: posted.id };
          },
          async postReply(reply) {
            const posted = await thread.post(reply.body);
            return { status: "posted", externalMessageId: posted.id };
          },
        },
      });
    },
  });

  const webhook = bot.webhooks.slack;
  if (webhook === undefined) {
    throw new Error("Slack Chat SDK webhook handler is not configured.");
  }

  const pendingTasks: Promise<unknown>[] = [];
  const response = await webhook(input.request, {
    waitUntil(task) {
      pendingTasks.push(task);
    },
  });
  await Promise.all(pendingTasks);
  return response;
}
