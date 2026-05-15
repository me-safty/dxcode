import type { Adapter } from "chat";
import { createSlackAdapter, type SlackAdapterConfig } from "@chat-adapter/slack";

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function slackAdapterConfig(): SlackAdapterConfig {
  const botToken = envValue("SLACK_BOT_TOKEN");
  const signingSecret = envValue("SLACK_SIGNING_SECRET");
  const botUserId = envValue("SLACK_BOT_USER_ID");
  const userName = envValue("SLACK_BOT_USERNAME");

  return {
    ...(botToken !== undefined ? { botToken } : {}),
    ...(signingSecret !== undefined ? { signingSecret } : {}),
    ...(botUserId !== undefined ? { botUserId } : {}),
    ...(userName !== undefined ? { userName } : {}),
  };
}

function createChatCompatibleSlackAdapter(config: SlackAdapterConfig): Adapter {
  const adapter = createSlackAdapter(config);
  // The Slack adapter's runtime shape satisfies Chat's adapter interface, but its
  // botUserId getter is typed as string | undefined under exactOptionalPropertyTypes.
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

export function chatUserName() {
  return envValue("SLACK_BOT_USERNAME") ?? "vevin";
}

export type TaskIntakeChatSdkSource = "slack";

export function createTaskIntakeChatSdkAdapters(input?: {
  readonly sources?: ReadonlySet<TaskIntakeChatSdkSource>;
}) {
  const sources = input?.sources ?? new Set<TaskIntakeChatSdkSource>(["slack"]);
  return sources.has("slack")
    ? { slack: createChatCompatibleSlackAdapter(slackAdapterConfig()) }
    : {};
}
