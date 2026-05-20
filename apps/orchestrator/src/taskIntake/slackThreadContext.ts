import type { Message, Thread } from "chat";

import { stripSlackClientAttribution } from "./slackMessageText.ts";

export interface SlackThreadContextOptions {
  readonly maxMessages?: number;
  readonly maxChars?: number;
}

function messageTimestamp(message: Message) {
  return message.metadata.dateSent.getTime();
}

function messageAuthorLabel(message: Message) {
  return (
    message.author.fullName.trim() ||
    message.author.userName.trim() ||
    message.author.userId.trim() ||
    "Someone"
  );
}

function messageAttachmentLines(message: Message) {
  return message.attachments
    .map((attachment, index) => {
      const url = attachment.url?.trim();
      if (!url) return null;
      return `${attachment.name?.trim() || `Attachment ${index + 1}`}: ${url}`;
    })
    .filter((line): line is string => line !== null);
}

function formatContextMessage(message: Message) {
  const text = stripSlackClientAttribution(message.text);
  const attachmentLines = messageAttachmentLines(message);
  const body =
    attachmentLines.length === 0
      ? text
      : [text.length > 0 ? text : "(attachment only)", ...attachmentLines].join("\n");
  if (body.length === 0) return null;
  return `${messageAuthorLabel(message)}: ${body}`;
}

export async function collectSlackThreadContext(
  thread: Thread,
  triggerMessage: Message,
  options: SlackThreadContextOptions = {},
) {
  const maxMessages = options.maxMessages ?? 30;
  const maxChars = options.maxChars ?? 8_000;
  const triggerTime = messageTimestamp(triggerMessage);
  const priorMessages: Message[] = [];

  for await (const message of thread.messages) {
    if (message.id === triggerMessage.id) continue;
    if (message.author.isMe === true || message.author.isBot === true) continue;
    if (messageTimestamp(message) > triggerTime) continue;
    priorMessages.push(message);
    if (priorMessages.length >= maxMessages) break;
  }

  const lines = priorMessages
    .toSorted((left, right) => messageTimestamp(left) - messageTimestamp(right))
    .map(formatContextMessage)
    .filter((line): line is string => line !== null);

  if (lines.length === 0) return undefined;

  const context = lines.join("\n\n");
  return context.length > maxChars ? context.slice(0, maxChars).trimEnd() : context;
}

export function buildInitialPromptContext(input: { readonly slackThreadContext?: string }) {
  const context = input.slackThreadContext?.trim();
  if (!context) return undefined;
  return [
    "- This task was started from a Slack thread where Vevin was invoked.",
    "- Use the prior Slack thread context below to interpret the user request.",
    "",
    "Prior Slack thread context:",
    "",
    context,
  ].join("\n");
}
