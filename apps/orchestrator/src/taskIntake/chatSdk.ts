import { Chat, type Adapter, type Message, type Thread } from "chat";
import {
  createLinearAdapter,
  type LinearAdapterConfig,
  type LinearRawMessage,
} from "@chat-adapter/linear";
import { createSlackAdapter, type SlackAdapterConfig, type SlackEvent } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";

import type { TaskIntakeMessage } from "./contracts.ts";

const taskIntakeChatSdkState = createMemoryState();

export interface TaskIntakeChatSdkOptions {
  readonly onMessage: (input: {
    readonly source: "linear" | "slack";
    readonly thread: Thread;
    readonly message: Message;
    readonly intakeMessage: TaskIntakeMessage;
  }) => Promise<void>;
}

function messageReceivedAt(message: Message) {
  return message.metadata.dateSent.toISOString();
}

function chatUserName() {
  return (
    process.env.LINEAR_BOT_USERNAME?.trim() ??
    process.env.SLACK_BOT_USERNAME?.trim() ??
    "engineering"
  );
}

function linearAdapterConfig(): LinearAdapterConfig {
  const clientId =
    process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_ID?.trim() ?? process.env.LINEAR_CLIENT_ID?.trim();
  const clientSecret =
    process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET?.trim() ??
    process.env.LINEAR_CLIENT_SECRET?.trim();
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET?.trim();
  const userName = process.env.LINEAR_BOT_USERNAME?.trim();

  if (clientId !== undefined && clientSecret !== undefined) {
    return {
      clientCredentials: {
        clientId,
        clientSecret,
        scopes: ["read", "write", "comments:create", "app:mentionable"],
      },
      ...(webhookSecret !== undefined ? { webhookSecret } : {}),
      ...(userName !== undefined ? { userName } : {}),
    };
  }

  return {
    ...(webhookSecret !== undefined ? { webhookSecret } : {}),
    ...(userName !== undefined ? { userName } : {}),
  };
}

function slackAdapterConfig(): SlackAdapterConfig {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  const botUserId = process.env.SLACK_BOT_USER_ID?.trim();
  const userName = process.env.SLACK_BOT_USERNAME?.trim();

  return {
    ...(botToken !== undefined ? { botToken } : {}),
    ...(signingSecret !== undefined ? { signingSecret } : {}),
    ...(botUserId !== undefined ? { botUserId } : {}),
    ...(userName !== undefined ? { userName } : {}),
  };
}

function createCompatibleSlackAdapter(config: SlackAdapterConfig): Adapter {
  const adapter = createSlackAdapter(config);
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "botUserId") {
        return target.botUserId ?? "";
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Adapter;
}

export function linearChatMessageToTaskIntakeMessage(input: {
  readonly thread: Thread;
  readonly message: Message<LinearRawMessage>;
}): TaskIntakeMessage {
  const comment = input.message.raw.comment;
  const commentId = comment.parentId ?? comment.id;

  return {
    eventId: `linear:${input.message.id}`,
    source: "linear",
    conversation: {
      source: "linear",
      externalLinkKind: "linear_issue",
      externalId: comment.issueId,
      issueId: comment.issueId,
      commentId,
      ...(comment.url !== undefined ? { url: comment.url } : {}),
    },
    messageId: input.message.id,
    text: input.message.text,
    receivedAt: messageReceivedAt(input.message),
    ...(comment.url !== undefined ? { url: comment.url } : {}),
    actor: {
      externalId: input.message.author.userId,
      displayName: input.message.author.userName || input.message.author.fullName,
    },
  };
}

export function slackChatMessageToTaskIntakeMessage(input: {
  readonly thread: Thread;
  readonly message: Message<SlackEvent>;
}): TaskIntakeMessage {
  const raw = input.message.raw;
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
    text: input.message.text,
    receivedAt: messageReceivedAt(input.message),
    actor: {
      externalId: input.message.author.userId,
      displayName: input.message.author.userName || input.message.author.fullName,
    },
  };
}

async function handleChatSdkMessage(
  source: "linear" | "slack",
  thread: Thread,
  message: Message,
  options: TaskIntakeChatSdkOptions,
) {
  await options.onMessage({
    source,
    thread,
    message,
    intakeMessage:
      source === "linear"
        ? linearChatMessageToTaskIntakeMessage({
            thread,
            message: message as Message<LinearRawMessage>,
          })
        : slackChatMessageToTaskIntakeMessage({
            thread,
            message: message as Message<SlackEvent>,
          }),
  });
}

export function createTaskIntakeChatSdkBot(options: TaskIntakeChatSdkOptions) {
  const bot = new Chat({
    userName: chatUserName(),
    adapters: {
      linear: createLinearAdapter(linearAdapterConfig()),
      slack: createCompatibleSlackAdapter(slackAdapterConfig()),
    },
    state: taskIntakeChatSdkState,
    dedupeTtlMs: 10 * 60 * 1000,
    logger: "info",
  });

  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    if (message.threadId.startsWith("linear:")) {
      await handleChatSdkMessage("linear", thread, message, options);
      return;
    }
    if (message.threadId.startsWith("slack:")) {
      await handleChatSdkMessage("slack", thread, message, options);
    }
  });

  bot.onSubscribedMessage(async (thread, message) => {
    if (message.threadId.startsWith("linear:")) {
      await handleChatSdkMessage("linear", thread, message, options);
      return;
    }
    if (message.threadId.startsWith("slack:")) {
      await handleChatSdkMessage("slack", thread, message, options);
    }
  });

  return bot;
}
