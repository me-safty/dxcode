import type { ChatAttachment, MessageId, ProviderKind } from "@t3tools/contracts";
import { resolveModelDisplayName } from "@t3tools/shared/model";

type HandoffMessage = {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
};

const MAX_HANDOFF_TRANSCRIPT_CHARS = 12_000;
const MAX_HANDOFF_MESSAGES = 24;

function formatAttachmentSummary(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  if (attachments.length === 1) {
    const attachment = attachments[0];
    return attachment ? `Attachment: ${attachment.name}` : "Attachment included";
  }

  return `Attachments: ${attachments.map((attachment) => attachment.name).join(", ")}`;
}

function formatTranscriptMessage(message: HandoffMessage): string {
  const roleLabel =
    message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
  const sections = [`${roleLabel}:`, message.text.trim() || "[No text content]"];
  const attachmentSummary = formatAttachmentSummary(message.attachments);
  if (attachmentSummary) {
    sections.push(`[${attachmentSummary}]`);
  }
  return sections.join("\n");
}

function buildTranscript(messages: ReadonlyArray<HandoffMessage>): string {
  const slices: string[] = [];
  let usedChars = 0;
  let usedCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const nextSlice = formatTranscriptMessage(message);
    const nextCost = nextSlice.length + 2;
    if (usedCount > 0 && usedChars + nextCost > MAX_HANDOFF_TRANSCRIPT_CHARS) {
      break;
    }
    slices.unshift(nextSlice);
    usedChars += nextCost;
    usedCount += 1;
    if (usedCount >= MAX_HANDOFF_MESSAGES || usedChars >= MAX_HANDOFF_TRANSCRIPT_CHARS) {
      break;
    }
  }

  const truncated = slices.length < messages.length;
  return [truncated ? "[Earlier conversation omitted for brevity]\n" : null, slices.join("\n\n")]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("");
}

export function buildProviderHandoffPrompt(input: {
  readonly messagesBeforeCurrent: ReadonlyArray<HandoffMessage>;
  readonly previousProvider: ProviderKind;
  readonly nextProvider: ProviderKind;
  readonly previousModel: string | undefined;
  readonly nextModel: string | undefined;
  readonly latestUserText: string;
  readonly latestAttachments?: ReadonlyArray<ChatAttachment>;
}): string | undefined {
  if (input.messagesBeforeCurrent.length === 0) {
    return undefined;
  }

  const transcript = buildTranscript(input.messagesBeforeCurrent);
  if (!transcript) {
    return undefined;
  }

  const previousModelLabel = resolveModelDisplayName(input.previousModel, input.previousProvider);
  const nextModelLabel = resolveModelDisplayName(input.nextModel, input.nextProvider);
  const latestAttachmentSummary = formatAttachmentSummary(input.latestAttachments);
  const latestUserText =
    input.latestUserText.trim().length > 0 ? input.latestUserText.trim() : "[No text content]";

  return [
    `You are continuing an existing conversation after switching from ${previousModelLabel || input.previousProvider} to ${nextModelLabel || input.nextProvider}.`,
    "Use the transcript below as prior context and continue naturally. Do not mention the model handoff unless the user asks about it.",
    "",
    "Conversation transcript:",
    transcript,
    "",
    "Latest user message:",
    latestUserText,
    latestAttachmentSummary ? `[${latestAttachmentSummary}]` : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function getMessagesBeforeMessage<T extends { readonly id: MessageId }>(
  messages: ReadonlyArray<T>,
  messageId: MessageId,
): ReadonlyArray<T> {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  return targetIndex <= 0 ? [] : messages.slice(0, targetIndex);
}
