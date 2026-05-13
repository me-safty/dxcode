import {
  Chat,
  type Attachment,
  type Message,
  type MessageContext,
  type StateAdapter,
  type Thread,
} from "chat";
import type { SlackEvent } from "@chat-adapter/slack";

import {
  chatUserName,
  createTaskIntakeChatSdkAdapters,
  type TaskIntakeChatSdkSource,
} from "./chatSdkAdapters.ts";
import type { TaskIntakeMessage } from "./contracts.ts";
import { stripSlackClientAttribution } from "./slackMessageText.ts";

export interface TaskIntakeChatSdkOptions {
  readonly sources?: ReadonlySet<TaskIntakeChatSdkSource>;
  readonly state: StateAdapter;
  readonly onMessage: (input: {
    readonly source: "slack";
    readonly thread: Thread;
    readonly message: Message;
    readonly context?: MessageContext;
    readonly intakeMessage: TaskIntakeMessage;
  }) => Promise<void>;
}

function messageReceivedAt(message: Message) {
  return message.metadata.dateSent.toISOString();
}

function taskIntakeAttachments(attachments: readonly Attachment[]) {
  return attachments
    .map((attachment) => {
      const url = attachment.url?.trim();
      if (!url) return null;

      return {
        ...(attachment.name?.trim() ? { name: attachment.name.trim() } : {}),
        url,
      };
    })
    .filter((attachment): attachment is { readonly name?: string; readonly url: string } => {
      return attachment !== null;
    });
}

export function slackChatMessageToTaskIntakeMessage(input: {
  readonly thread: Thread;
  readonly message: Message<SlackEvent>;
}): TaskIntakeMessage {
  const raw = input.message.raw;
  const attachments = taskIntakeAttachments(input.message.attachments);
  const [, channelFromThread, tsFromThread] = input.thread.id.split(":");
  const channelId = raw.channel ?? channelFromThread ?? input.thread.channelId;
  const threadTs = raw.thread_ts ?? tsFromThread ?? raw.ts ?? input.message.id;
  const teamId = raw.team_id ?? raw.team;
  const externalId =
    teamId === undefined ? `${channelId}:${threadTs}` : `${teamId}:${channelId}:${threadTs}`;

  return {
    eventId: `slack:${input.message.id}`,
    source: "slack",
    conversation: {
      source: "slack",
      externalLinkKind: "slack_thread",
      externalId,
      channelId,
      ...(teamId !== undefined ? { teamId } : {}),
    },
    messageId: input.message.id,
    text: stripSlackClientAttribution(input.message.text),
    ...(attachments.length > 0 ? { attachments } : {}),
    receivedAt: messageReceivedAt(input.message),
    actor: {
      externalId: input.message.author.userId,
      displayName: input.message.author.userName || input.message.author.fullName,
    },
  };
}

async function handleChatSdkMessage(
  thread: Thread,
  message: Message,
  context: MessageContext | undefined,
  options: TaskIntakeChatSdkOptions,
) {
  await options.onMessage({
    source: "slack",
    thread,
    message,
    ...(context !== undefined ? { context } : {}),
    intakeMessage: slackChatMessageToTaskIntakeMessage({
      thread,
      message: message as Message<SlackEvent>,
    }),
  });
}

export function chatSdkSourceFromThreadId(threadId: string): "slack" | null {
  if (threadId.startsWith("slack:")) return "slack";
  return null;
}

export function createTaskIntakeChatSdkBot(options: TaskIntakeChatSdkOptions) {
  const bot = new Chat({
    userName: chatUserName(),
    adapters: createTaskIntakeChatSdkAdapters(
      options.sources === undefined ? undefined : { sources: options.sources },
    ),
    state: options.state,
    dedupeTtlMs: 10 * 60 * 1000,
    concurrency: "queue",
    logger: "info",
  });

  bot.onNewMention(async (thread, message, context) => {
    await thread.subscribe();
    const source = chatSdkSourceFromThreadId(message.threadId);
    if (source !== null) {
      await handleChatSdkMessage(thread, message, context, options);
    }
  });

  bot.onSubscribedMessage(async (thread, message, context) => {
    const source = chatSdkSourceFromThreadId(message.threadId);
    if (source !== null) {
      await handleChatSdkMessage(thread, message, context, options);
    }
  });

  return bot;
}
