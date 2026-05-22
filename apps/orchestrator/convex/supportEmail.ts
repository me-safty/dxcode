"use node";

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import { v } from "convex/values";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ModelSelection,
} from "@t3tools/contracts";

import type { TaskIntakeMessage } from "../src/taskIntake/contracts.ts";
import { handleTaskIntakeMessage } from "../src/taskIntake/ingress.ts";
import { buildT3ThreadUrl } from "../src/taskIntake/postableReply.ts";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalAction } from "./_generated/server.js";

const RESEND_API_BASE_URL = "https://api.resend.com";

const SUPPORT_EMAIL_AGENT_PROMPT = [
  "- This task was started from a support email intake.",
  "- The user request below contains the received email content, including headers, body, and attachment links.",
  "- Use the received email content as the source message for this task.",
].join("\n");

interface HeaderArg {
  readonly name: string;
  readonly value: string;
}

interface ResendReceivedEmailWebhook {
  readonly type?: unknown;
  readonly created_at?: unknown;
  readonly data?: {
    readonly email_id?: unknown;
    readonly created_at?: unknown;
    readonly from?: unknown;
    readonly to?: unknown;
    readonly bcc?: unknown;
    readonly cc?: unknown;
    readonly message_id?: unknown;
    readonly subject?: unknown;
    readonly attachments?: unknown;
  };
}

interface ResendReceivedEmail {
  readonly id: string;
  readonly to?: readonly string[];
  readonly from?: string;
  readonly created_at?: string;
  readonly subject?: string | null;
  readonly html?: string | null;
  readonly text?: string | null;
  readonly headers?: Record<string, string>;
  readonly bcc?: readonly string[];
  readonly cc?: readonly string[];
  readonly reply_to?: readonly string[];
  readonly message_id?: string | null;
  readonly attachments?: ReadonlyArray<{
    readonly id?: string;
    readonly filename?: string | null;
    readonly content_type?: string | null;
    readonly content_disposition?: string | null;
    readonly content_id?: string | null;
  }>;
}

interface StoredEmailAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly sizeBytes: number;
  readonly storageId: string;
  readonly url: string;
  readonly nativeImageDataUrl?: string;
}

interface FailedEmailAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly error: string;
}

type ProcessedEmailAttachment = StoredEmailAttachment | FailedEmailAttachment;

function isStoredEmailAttachment(
  attachment: ProcessedEmailAttachment,
): attachment is StoredEmailAttachment {
  return "url" in attachment;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requiredEnv(name: string) {
  const value = envValue(name);
  if (value === undefined) {
    throw new Error(`Missing required support email environment variable: ${name}`);
  }
  return value;
}

function errorSummary(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function t3WebAppBaseUrl() {
  return envValue("T3_WEB_APP_BASE_URL") ?? envValue("T3_EXECUTION_BRIDGE_BASE_URL") ?? undefined;
}

function supportGroupAddress() {
  return envValue("SUPPORT_EMAIL_GROUP_ADDRESS") ?? "support@example.com";
}

function internalEmailDomains() {
  return (envValue("SUPPORT_EMAIL_INTERNAL_DOMAINS") ?? "example.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function supportEmailTriagePrompt() {
  const productName = envValue("SUPPORT_EMAIL_PRODUCT_NAME") ?? "the configured product";
  const repoName = envValue("SUPPORT_EMAIL_REPO_NAME") ?? "the configured repo";
  const adminUserUrlTemplate =
    envValue("SUPPORT_EMAIL_ADMIN_USER_URL_TEMPLATE") ??
    "the configured admin user URL for the affected account";
  const postHogPersonUrlTemplate =
    envValue("SUPPORT_EMAIL_POSTHOG_PERSON_URL_TEMPLATE") ??
    "the configured PostHog person URL for the affected user";
  const staffDomains = internalEmailDomains().join(", ") || "configured internal domains";

  return [
    `You are triaging a support email for ${productName}. Treat the issue as related to the ${repoName} repo unless the evidence clearly says otherwise.`,
    "",
    `Before doing any triage, decide whether the top-level email is actually from a user reporting an active issue. The email may be a follow-up from staff at ${staffDomains}, with quoted user context below it. If staff is saying the issue was fixed, asking the user for more information, asking the user to retry something, or otherwise handling the thread without a new user-reported problem, do not investigate the quoted issue. Respond briefly that no triage is needed and explain why.`,
    "",
    "Only do the triage work below when the current top-level message is clearly from a user with an active issue, or when staff is explicitly forwarding a user-reported issue for investigation.",
    "",
    "First classify the request: product bug, account/data issue, billing/subscription issue, user confusion, feature request, or spam/no-action. Not every email needs a code change.",
    "",
    `Identify the affected user or account from the email. Use Convex production data to find the related ${productName} user document. Report the Convex prod user document id, the admin URL using ${adminUserUrlTemplate}, and the Clerk id when present. Do not report Convex external ids.`,
    "",
    `Use PostHog CLI/MCP and the email details to find matching PostHog persons and activity around the likely time of the issue. Include full PostHog person URLs using ${postHogPersonUrlTemplate}. Do not use relative links. Summarize relevant recent events, sessions, errors, or absence of evidence.`,
    "",
    `Inspect the ${repoName} repo when code behavior is relevant, but do not make code changes and do not open a PR. If a code change appears necessary, describe the recommended change at a high level with the likely files or systems to inspect.`,
    "",
    "End with a concise triage summary: classification, user/account links, observed evidence, recommended next steps, and any missing information needed.",
  ].join("\n");
}

function debuggingChannelId() {
  return requiredEnv("SUPPORT_EMAIL_SLACK_CHANNEL_ID");
}

function slackTeamId() {
  return envValue("SLACK_TEAM_ID");
}

async function resolveSlackTeamId() {
  const configuredTeamId = slackTeamId();
  if (configuredTeamId !== undefined) return configuredTeamId;

  const response = await fetch("https://slack.com/api/auth.test", {
    headers: {
      authorization: `Bearer ${requiredEnv("SLACK_BOT_TOKEN")}`,
    },
  });
  const parsed = (await response.json()) as {
    readonly ok?: boolean;
    readonly team_id?: string;
    readonly error?: string;
  };
  if (!response.ok || parsed.ok !== true) {
    throw new Error(`Slack auth.test failed: ${parsed.error ?? response.statusText}`);
  }
  if (parsed.team_id === undefined || parsed.team_id.trim().length === 0) {
    throw new Error("Slack auth.test did not return team_id");
  }
  return parsed.team_id;
}

function supportEmailSlackExternalId(input: {
  readonly channelId: string;
  readonly threadTs: string;
  readonly teamId?: string;
}) {
  const teamId = input.teamId ?? slackTeamId();
  return teamId === undefined
    ? `${input.channelId}:${input.threadTs}`
    : `${teamId}:${input.channelId}:${input.threadTs}`;
}

function supportEmailSlackThreadId(input: {
  readonly channelId: string;
  readonly threadTs: string;
}) {
  return `slack:${input.channelId}:${input.threadTs}`;
}

function headerValue(headers: readonly HeaderArg[], name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function emailHeaderValue(email: ResendReceivedEmail, name: string) {
  const headers = email.headers ?? {};
  const header = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return header?.[1];
}

function secretBytes(secret: string) {
  return Buffer.from(
    secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret,
    "base64",
  );
}

function verifyResendWebhookSignature(input: {
  readonly payload: string;
  readonly headers: readonly HeaderArg[];
}) {
  const webhookSecret = requiredEnv("RESEND_WEBHOOK_SECRET");
  const id = headerValue(input.headers, "svix-id");
  const timestamp = headerValue(input.headers, "svix-timestamp");
  const signatureHeader = headerValue(input.headers, "svix-signature");

  if (id === undefined || timestamp === undefined || signatureHeader === undefined) {
    throw new Error("Missing Resend webhook signature headers");
  }

  const signedPayload = `${id}.${timestamp}.${input.payload}`;
  const expected = createHmac("sha256", secretBytes(webhookSecret)).update(signedPayload).digest();

  const signatures = signatureHeader
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [version, signature] = part.split(",");
      return version === "v1" && signature ? [signature] : [];
    });

  for (const signature of signatures) {
    const actual = Buffer.from(signature, "base64");
    if (actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)) {
      return;
    }
  }

  throw new Error("Invalid Resend webhook signature");
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function emailBody(email: ResendReceivedEmail) {
  const text = email.text?.trim();
  if (text) return text;

  const html = email.html?.trim();
  if (html) return htmlToText(html);

  return "(empty email body)";
}

function truncate(input: string, maxLength: number) {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength - 15)}\n...[truncated]`;
}

function normalizeEmailAddress(value: string) {
  const match = /<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i.exec(value);
  return match?.[1]?.toLowerCase();
}

function emailAddressesFromText(value: string | undefined) {
  if (value === undefined) return [];

  const addresses = new Set<string>();
  for (const match of value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const normalized = normalizeEmailAddress(match[0]);
    if (normalized !== undefined) addresses.add(normalized);
  }
  return [...addresses];
}

function isSupportAddress(address: string) {
  return address === supportGroupAddress().toLowerCase();
}

function isInternalEmailAddress(address: string) {
  const [, domain] = address.split("@");
  return domain !== undefined && internalEmailDomains().includes(domain.toLowerCase());
}

function externalParticipantAddresses(email: ResendReceivedEmail) {
  const values = [
    email.from,
    ...(email.reply_to ?? []),
    ...emailAddressesFromText(email.text ?? undefined),
    ...emailAddressesFromText(email.html ?? undefined),
  ];
  const addresses = new Set<string>();
  for (const value of values) {
    for (const address of emailAddressesFromText(value)) {
      if (!isSupportAddress(address) && !isInternalEmailAddress(address)) {
        addresses.add(address);
      }
    }
  }
  return [...addresses].toSorted();
}

function normalizedConversationSubject(email: ResendReceivedEmail) {
  const subject = email.subject?.trim();
  if (!subject) return undefined;

  const normalized = subject
    .replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function isForwardLikeEmail(email: ResendReceivedEmail) {
  const subject = email.subject ?? "";
  if (/^\s*(?:fw|fwd)\s*:/i.test(subject)) return true;

  const body = `${email.text ?? ""}\n${email.html ?? ""}`;
  return /forwarded message|begin forwarded message|original message/i.test(body);
}

function isFromInternalSender(email: ResendReceivedEmail) {
  const sender = normalizeEmailAddress(email.from ?? "");
  return sender !== undefined && isInternalEmailAddress(sender);
}

function supportEmailConversationExternalIds(email: ResendReceivedEmail) {
  const subject = normalizedConversationSubject(email);
  if (subject === undefined) return [];

  return externalParticipantAddresses(email).map((address) => `conversation:${address}:${subject}`);
}

function normalizeMessageId(value: string) {
  return value.trim().replace(/^<+/, "").replace(/>+$/, "").trim().toLowerCase();
}

function messageIdExternalId(messageId: string) {
  return `message:${normalizeMessageId(messageId)}`;
}

function messageIdsFromHeader(value: string | undefined) {
  if (value === undefined) return [];

  const ids = new Set<string>();
  for (const match of value.matchAll(/<([^>]+)>/g)) {
    const normalized = normalizeMessageId(match[1] ?? "");
    if (normalized.length > 0) ids.add(messageIdExternalId(normalized));
  }

  if (ids.size === 0) {
    for (const part of value.split(/\s+/)) {
      const normalized = normalizeMessageId(part);
      if (normalized.includes("@")) ids.add(messageIdExternalId(normalized));
    }
  }

  return [...ids];
}

function legacyMessageIdExternalIds(value: string | undefined) {
  if (value === undefined) return [];

  const ids = new Set<string>();
  const trimmed = value.trim();
  if (trimmed.length > 0) ids.add(trimmed);

  for (const match of value.matchAll(/<([^>]+)>/g)) {
    const full = match[0]?.trim();
    const inner = match[1]?.trim();
    if (full && full.length > 0) ids.add(full);
    if (inner && inner.length > 0) ids.add(inner);
  }

  return [...ids];
}

function supportEmailOwnExternalIds(email: ResendReceivedEmail) {
  const ids = new Set<string>();
  const messageId = email.message_id ?? emailHeaderValue(email, "message-id");
  if (messageId !== undefined) {
    for (const id of messageIdsFromHeader(messageId)) {
      ids.add(id);
    }
    for (const id of legacyMessageIdExternalIds(messageId)) {
      ids.add(id);
    }
  }
  ids.add(`resend:${email.id}`);
  return [...ids];
}

function supportEmailStoredExternalIds(email: ResendReceivedEmail) {
  return [
    ...new Set([
      ...supportEmailOwnExternalIds(email),
      ...supportEmailConversationExternalIds(email),
    ]),
  ];
}

function supportEmailReferencedExternalIds(email: ResendReceivedEmail) {
  const ids = new Set<string>();
  for (const headerName of ["in-reply-to", "references"]) {
    const header = emailHeaderValue(email, headerName);
    for (const id of messageIdsFromHeader(header)) {
      ids.add(id);
    }
    for (const id of legacyMessageIdExternalIds(header)) {
      ids.add(id);
    }
  }
  return [...ids];
}

function supportEmailForwardFallbackExternalIds(email: ResendReceivedEmail) {
  if (!isFromInternalSender(email) || !isForwardLikeEmail(email)) return [];
  return supportEmailConversationExternalIds(email);
}

function supportEmailActorExternalId(email: ResendReceivedEmail) {
  return supportEmailOwnExternalIds(email)[0] ?? `resend:${email.id}`;
}

async function findExistingSupportEmailThread(ctx: any, email: ResendReceivedEmail) {
  for (const externalId of [
    ...supportEmailReferencedExternalIds(email),
    ...supportEmailOwnExternalIds(email),
    ...supportEmailForwardFallbackExternalIds(email),
  ]) {
    const existing = await ctx.runQuery(api.taskExternalLinks.findTaskExternalLink, {
      kind: "support_email_thread",
      externalId,
    });
    if (existing !== null) {
      return { existing, externalId };
    }
  }

  return null;
}

async function upsertSupportEmailThreadLinks(
  ctx: any,
  input: {
    readonly taskId: Id<"tasks">;
    readonly email: ResendReceivedEmail;
    readonly url?: string | undefined;
  },
) {
  for (const supportExternalId of supportEmailStoredExternalIds(input.email)) {
    await ctx.runMutation(api.taskExternalLinks.upsertTaskExternalLink, {
      taskId: input.taskId,
      kind: "support_email_thread",
      externalId: supportExternalId,
      muted: true,
      ...(input.url !== undefined ? { url: input.url } : {}),
      syncCursor: input.email.id,
    });
  }
}

function attachmentLines(attachments: readonly ProcessedEmailAttachment[]) {
  if (attachments.length === 0) return [];

  return [
    "",
    "Attachments:",
    ...attachments.map((attachment) => {
      if (!isStoredEmailAttachment(attachment)) {
        const type = attachment.mimeType?.trim();
        return type
          ? `- ${attachment.name} (${type}): failed to store (${attachment.error})`
          : `- ${attachment.name}: failed to store (${attachment.error})`;
      }

      const type = attachment.mimeType?.trim();
      const size = Number.isFinite(attachment.sizeBytes) ? `, ${attachment.sizeBytes} bytes` : "";
      return type
        ? `- ${attachment.name} (${type}${size}): ${attachment.url}`
        : `- ${attachment.name}${size}: ${attachment.url}`;
    }),
  ];
}

function formattedEmail(
  email: ResendReceivedEmail,
  attachments: readonly ProcessedEmailAttachment[] = [],
) {
  return [
    `From: ${email.from ?? "(unknown sender)"}`,
    `To: ${(email.to ?? [supportGroupAddress()]).join(", ")}`,
    ...(email.cc !== undefined && email.cc.length > 0 ? [`Cc: ${email.cc.join(", ")}`] : []),
    ...(email.created_at !== undefined ? [`Date: ${email.created_at}`] : []),
    `Subject: ${email.subject ?? "(no subject)"}`,
    "",
    emailBody(email),
    ...attachmentLines(attachments),
  ].join("\n");
}

function supportEmailTitle(email: ResendReceivedEmail) {
  const subject = email.subject?.trim();
  return subject && subject.length > 0 ? `Support: ${subject}` : "Support email triage";
}

function supportEmailSlackTitle(email: ResendReceivedEmail) {
  const sender = normalizeEmailAddress(email.from ?? "") ?? email.from?.trim() ?? "unknown sender";
  return `New support email from ${sender}: ${email.subject ?? "(no subject)"}`;
}

function initialSlackMessageText(
  email: ResendReceivedEmail,
  attachments: readonly ProcessedEmailAttachment[],
) {
  return truncate(
    [
      supportEmailSlackTitle(email),
      "",
      "```",
      formattedEmail(email, attachments),
      "```",
      "",
      "Starting T3 triage...",
    ].join("\n"),
    38000,
  );
}

function slackMrkdwnSectionChunks(input: string) {
  const chunks: string[] = [];
  let remaining = input;
  while (remaining.length > 0 && chunks.length < 42) {
    chunks.push(remaining.slice(0, 2800));
    remaining = remaining.slice(2800);
  }
  if (remaining.length > 0 && chunks.length > 0) {
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n...[truncated]`;
  }
  return chunks;
}

function supportEmailSlackBlocks(input: {
  readonly email: ResendReceivedEmail;
  readonly attachments: readonly ProcessedEmailAttachment[];
  readonly t3ThreadUrl?: string | undefined;
}) {
  const emailText = truncate(formattedEmail(input.email, input.attachments), 32000);
  const emailSections = slackMrkdwnSectionChunks(emailText).map((text) => ({
    type: "section",
    text: { type: "mrkdwn", text: `\`\`\`\n${text}\n\`\`\`` },
  }));
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${supportEmailSlackTitle(input.email)}*`,
      },
    },
    ...emailSections,
    ...(input.t3ThreadUrl !== undefined
      ? [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open T3" },
                url: input.t3ThreadUrl,
                style: "primary",
              },
            ],
          },
        ]
      : []),
  ];
}

async function retrieveReceivedEmail(emailId: string) {
  const response = await fetch(
    `${RESEND_API_BASE_URL}/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: {
        authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Resend received email fetch failed (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { readonly data?: unknown } | ResendReceivedEmail;
  const email = "data" in body && body.data !== undefined ? body.data : body;
  if (
    email === null ||
    typeof email !== "object" ||
    typeof (email as { id?: unknown }).id !== "string"
  ) {
    throw new Error("Resend received email response did not include an email id");
  }
  return email as ResendReceivedEmail;
}

async function retrieveReceivedEmailAttachment(input: {
  readonly emailId: string;
  readonly attachmentId: string;
}) {
  const response = await fetch(
    `${RESEND_API_BASE_URL}/emails/receiving/${encodeURIComponent(input.emailId)}/attachments/${encodeURIComponent(input.attachmentId)}`,
    {
      headers: {
        authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Resend attachment fetch failed (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    readonly data?: unknown;
    readonly id?: unknown;
    readonly filename?: unknown;
    readonly size?: unknown;
    readonly content_type?: unknown;
    readonly download_url?: unknown;
  };
  const attachment = "data" in body && body.data !== undefined ? body.data : body;
  if (
    attachment === null ||
    typeof attachment !== "object" ||
    typeof (attachment as { download_url?: unknown }).download_url !== "string"
  ) {
    throw new Error("Resend attachment response did not include download_url");
  }
  return attachment as {
    readonly id?: string;
    readonly filename?: string | null;
    readonly size?: number;
    readonly content_type?: string | null;
    readonly download_url: string;
  };
}

async function downloadAttachmentBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status}): ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isNativeImageCandidate(input: {
  readonly mimeType: string | undefined;
  readonly sizeBytes: number;
}) {
  return (
    input.mimeType?.toLowerCase().startsWith("image/") === true &&
    input.sizeBytes > 0 &&
    input.sizeBytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
  );
}

async function processEmailAttachments(
  ctx: any,
  email: ResendReceivedEmail,
): Promise<ProcessedEmailAttachment[]> {
  const attachments: ProcessedEmailAttachment[] = [];
  let nativeImageCount = 0;

  for (const [index, attachment] of (email.attachments ?? []).entries()) {
    const attachmentId = attachment.id?.trim();
    if (!attachmentId) continue;

    const name =
      attachment.filename?.trim() || attachment.content_id?.trim() || `Attachment ${index + 1}`;
    const fallbackMimeType = attachment.content_type ?? undefined;

    try {
      const detail = await retrieveReceivedEmailAttachment({
        emailId: email.id,
        attachmentId,
      });
      const bytes = await downloadAttachmentBytes(detail.download_url);
      const mimeType = detail.content_type ?? fallbackMimeType;
      const storedName = detail.filename?.trim() || name;
      const blob = new Blob([bytes], mimeType !== undefined ? { type: mimeType } : undefined);
      const storageId = await ctx.storage.store(blob);
      const url = await ctx.storage.getUrl(storageId);
      if (typeof url !== "string") {
        throw new Error(`Convex storage URL was not available for attachment ${storedName}`);
      }

      const includeNativeImage =
        nativeImageCount < PROVIDER_SEND_TURN_MAX_ATTACHMENTS &&
        isNativeImageCandidate({ mimeType, sizeBytes: bytes.byteLength });
      if (includeNativeImage) nativeImageCount += 1;

      attachments.push({
        id: attachmentId,
        name: storedName,
        ...(mimeType !== undefined ? { mimeType } : {}),
        sizeBytes: bytes.byteLength,
        storageId: String(storageId),
        url,
        ...(includeNativeImage
          ? { nativeImageDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` }
          : {}),
      });
    } catch (error) {
      const summary = errorSummary(error);
      console.warn("supportEmail.attachment.store.failed", {
        emailId: email.id,
        attachmentId,
        name,
        error: summary,
      });
      attachments.push({
        id: attachmentId,
        name,
        ...(fallbackMimeType !== undefined ? { mimeType: fallbackMimeType } : {}),
        error: summary,
      });
    }
  }

  return attachments;
}

async function postSlackMessage(input: {
  readonly channelId: string;
  readonly text: string;
  readonly threadTs?: string;
  readonly blocks?: readonly unknown[];
}) {
  const body = {
    channel: input.channelId,
    text: input.text,
    mrkdwn: true,
    ...(input.threadTs !== undefined ? { thread_ts: input.threadTs } : {}),
    ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
  };
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("SLACK_BOT_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as {
    readonly ok?: boolean;
    readonly error?: string;
    readonly ts?: string;
    readonly channel?: string;
  };
  if (!response.ok || parsed.ok !== true || parsed.ts === undefined) {
    throw new Error(`Slack chat.postMessage failed: ${parsed.error ?? response.statusText}`);
  }
  return {
    channelId: parsed.channel ?? input.channelId,
    ts: parsed.ts,
  };
}

async function updateSlackMessage(input: {
  readonly channelId: string;
  readonly ts: string;
  readonly text: string;
  readonly blocks?: readonly unknown[];
}) {
  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("SLACK_BOT_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel: input.channelId,
      ts: input.ts,
      text: input.text,
      mrkdwn: true,
      ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
    }),
  });
  const parsed = (await response.json()) as { readonly ok?: boolean; readonly error?: string };
  if (!response.ok || parsed.ok !== true) {
    throw new Error(`Slack chat.update failed: ${parsed.error ?? response.statusText}`);
  }
}

function toConvexModelSelection(modelSelection: ModelSelection | undefined) {
  if (modelSelection === undefined) return undefined;
  return {
    instanceId: modelSelection.instanceId,
    model: modelSelection.model,
    ...(modelSelection.options !== undefined
      ? {
          options: modelSelection.options.map((option) => ({
            id: option.id,
            value: option.value,
          })),
        }
      : {}),
  };
}

function buildIntakeMessage(input: {
  readonly email: ResendReceivedEmail;
  readonly attachments: readonly ProcessedEmailAttachment[];
  readonly channelId: string;
  readonly threadTs: string;
  readonly teamId?: string;
}): TaskIntakeMessage {
  const externalId = supportEmailSlackExternalId(input);
  const receivedAt = input.email.created_at ?? new Date().toISOString();
  const nativeImageAttachments = input.attachments.flatMap((attachment) =>
    !isStoredEmailAttachment(attachment) || attachment.nativeImageDataUrl === undefined
      ? []
      : [
          {
            type: "image" as const,
            name: attachment.name,
            ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
            sizeBytes: attachment.sizeBytes,
            dataUrl: attachment.nativeImageDataUrl,
            url: attachment.url,
          },
        ],
  );
  return {
    eventId: `support-email:${input.email.id}:slack-bootstrap`,
    source: "slack",
    conversation: {
      source: "slack",
      externalLinkKind: "slack_thread",
      externalId,
      channelId: input.channelId,
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
    },
    messageId: input.threadTs,
    text: formattedEmail(input.email, input.attachments),
    ...(nativeImageAttachments.length > 0 ? { attachments: nativeImageAttachments } : {}),
    receivedAt,
    actor: {
      externalId: supportEmailActorExternalId(input.email),
      displayName: input.email.from ?? "Support Email",
    },
  };
}

function slackThreadUrl(input: { readonly channelId: string; readonly threadTs: string }) {
  const workspace = envValue("SLACK_WORKSPACE_URL")?.replace(/\/$/, "");
  if (workspace === undefined) return undefined;
  return `${workspace}/archives/${input.channelId}/p${input.threadTs.replace(".", "")}`;
}

function supportLinkUrl(input: { readonly channelId: string; readonly threadTs: string }) {
  return slackThreadUrl(input);
}

async function processReceivedEmail(ctx: any, email: ResendReceivedEmail) {
  const supportExternalIds = supportEmailStoredExternalIds(email);
  const primarySupportExternalId = supportExternalIds[0] ?? `resend:${email.id}`;
  const existing = await findExistingSupportEmailThread(ctx, email);
  if (existing !== null) {
    await upsertSupportEmailThreadLinks(ctx, {
      taskId: existing.existing.taskId as Id<"tasks">,
      email,
      ...(existing.existing.url !== undefined ? { url: existing.existing.url } : {}),
    });
    return { status: "duplicate" as const, emailId: email.id };
  }

  const attachments = await processEmailAttachments(ctx, email);
  const channelId = debuggingChannelId();
  const teamId = await resolveSlackTeamId();
  const parent = await postSlackMessage({
    channelId,
    text: initialSlackMessageText(email, attachments),
    blocks: supportEmailSlackBlocks({ email, attachments }),
  });
  const threadTs = parent.ts;
  await ctx.runMutation(internal.chatSdkState.subscribe, {
    threadId: supportEmailSlackThreadId({ channelId: parent.channelId, threadTs }),
  });

  const intakeMessage = buildIntakeMessage({
    email,
    attachments,
    channelId: parent.channelId,
    threadTs,
    teamId,
  });
  const result = await handleTaskIntakeMessage(
    intakeMessage,
    {
      store: {
        async resolveMessage(input) {
          return await ctx.runMutation(internal.tasks.resolveTaskIntakeMessage, {
            eventId: input.message.eventId,
            source: input.message.source,
            externalLinkKind: input.externalLink.kind,
            externalId: input.externalLink.externalId,
            title: supportEmailTitle(email),
            text: input.message.text,
            messageId: input.message.messageId,
            receivedAt: input.message.receivedAt,
            ...(input.message.conversation.teamId !== undefined
              ? { teamId: input.message.conversation.teamId }
              : {}),
            ...(input.message.conversation.channelId !== undefined
              ? { channelId: input.message.conversation.channelId }
              : {}),
            ...(input.message.actor?.displayName !== undefined
              ? { actorDisplayName: input.message.actor.displayName }
              : {}),
          });
        },
        async recordStartFailed(input) {
          await ctx.runMutation(internal.tasks.markTaskIntakeStartFailed, {
            eventId: input.message.eventId,
            taskId: input.taskId as Id<"tasks">,
            source: input.message.source,
            summary: input.summary,
          });
        },
      },
      runtime: {
        async materializeTaskRuntime(input) {
          const modelSelection = toConvexModelSelection(input.modelSelection);
          return await ctx.runAction(api.t3Runtime.materializeTaskRuntime, {
            taskId: input.taskId as Id<"tasks">,
            initialPrompt: input.initialPrompt,
            ...(input.attachments !== undefined ? { attachments: [...input.attachments] } : {}),
            startCodingAgent: input.startCodingAgent,
            ...(modelSelection !== undefined ? { modelSelection } : {}),
          });
        },
        async continueTaskRuntime(input) {
          return await ctx.runAction(api.t3Runtime.continueTaskRuntime, {
            eventId: input.eventId,
            taskId: input.taskId as Id<"tasks">,
            workSessionId: input.workSessionId as Id<"workSessions">,
            t3ThreadId: input.t3ThreadId,
            prompt: input.prompt,
            ...(input.attachments !== undefined ? { attachments: [...input.attachments] } : {}),
          });
        },
      },
      replies: {
        async acknowledgeAccepted() {
          return { status: "skipped", reason: "email bootstrap already posted to Slack" };
        },
        async postTaskStartedCard({ taskId, materialization }) {
          const t3ThreadUrl = buildT3ThreadUrl({
            baseUrl: t3WebAppBaseUrl(),
            environmentId: materialization.environmentId,
            t3ThreadId: materialization.t3ThreadId,
          });
          const text = truncate(
            [
              supportEmailSlackTitle(email),
              "",
              "```",
              formattedEmail(email, attachments),
              "```",
              ...(t3ThreadUrl === undefined ? [] : ["", `Open T3: ${t3ThreadUrl}`]),
            ].join("\n"),
            38000,
          );
          await updateSlackMessage({
            channelId: parent.channelId,
            ts: threadTs,
            text,
            blocks: supportEmailSlackBlocks({ email, attachments, t3ThreadUrl }),
          });
          await ctx.runMutation(api.taskExternalLinks.upsertTaskExternalLink, {
            taskId: taskId as Id<"tasks">,
            kind: "slack_thread",
            externalId: supportEmailSlackExternalId({
              channelId: parent.channelId,
              threadTs,
              teamId,
            }),
            muted: false,
            ...(supportLinkUrl({ channelId: parent.channelId, threadTs }) !== undefined
              ? { url: supportLinkUrl({ channelId: parent.channelId, threadTs }) }
              : {}),
          });
          await upsertSupportEmailThreadLinks(ctx, {
            taskId: taskId as Id<"tasks">,
            email,
            ...(supportLinkUrl({ channelId: parent.channelId, threadTs }) !== undefined
              ? { url: supportLinkUrl({ channelId: parent.channelId, threadTs }) }
              : {}),
          });
          return { status: "posted", externalMessageId: threadTs };
        },
        async postReply(reply) {
          const posted = await postSlackMessage({
            channelId: parent.channelId,
            threadTs,
            text: reply.body,
          });
          return { status: "posted", externalMessageId: posted.ts };
        },
      },
    },
    {
      initialTriagePrompt: supportEmailTriagePrompt(),
      initialPromptContext: SUPPORT_EMAIL_AGENT_PROMPT,
    },
  );

  if (result.taskId !== undefined) {
    await ctx.runMutation(api.taskExternalLinks.upsertTaskExternalLink, {
      taskId: result.taskId as Id<"tasks">,
      kind: "slack_thread",
      externalId: supportEmailSlackExternalId({ channelId: parent.channelId, threadTs, teamId }),
      muted: false,
      ...(supportLinkUrl({ channelId: parent.channelId, threadTs }) !== undefined
        ? { url: supportLinkUrl({ channelId: parent.channelId, threadTs }) }
        : {}),
    });
    await upsertSupportEmailThreadLinks(ctx, {
      taskId: result.taskId as Id<"tasks">,
      email,
      ...(supportLinkUrl({ channelId: parent.channelId, threadTs }) !== undefined
        ? { url: supportLinkUrl({ channelId: parent.channelId, threadTs }) }
        : {}),
    });
  }

  return {
    status: "processed" as const,
    emailId: email.id,
    supportExternalId: primarySupportExternalId,
    taskId: result.taskId,
    t3ThreadId: result.t3ThreadId,
    slackThreadTs: threadTs,
  };
}

function decodeResendWebhook(payload: string) {
  const event = JSON.parse(payload) as ResendReceivedEmailWebhook;
  if (event.type !== "email.received") {
    return { type: "ignored" as const, eventType: String(event.type ?? "unknown") };
  }

  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || emailId.trim().length === 0) {
    throw new Error("Resend email.received webhook is missing data.email_id");
  }

  return { type: "email.received" as const, emailId };
}

export const handleResendWebhook = internalAction({
  args: {
    headers: v.array(v.object({ name: v.string(), value: v.string() })),
    body: v.string(),
  },
  returns: v.object({
    accepted: v.boolean(),
    ignored: v.boolean(),
    reason: v.optional(v.string()),
    emailId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    t3ThreadId: v.optional(v.string()),
    slackThreadTs: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    verifyResendWebhookSignature({
      payload: args.body,
      headers: args.headers,
    });

    const decoded = decodeResendWebhook(args.body);
    if (decoded.type === "ignored") {
      return {
        accepted: true,
        ignored: true,
        reason: `ignored_event_type:${decoded.eventType}`,
      };
    }

    const email = await retrieveReceivedEmail(decoded.emailId);
    const result = await processReceivedEmail(ctx, email);
    if (result.status === "duplicate") {
      return {
        accepted: true,
        ignored: true,
        reason: "duplicate_email",
        emailId: result.emailId,
      };
    }

    return {
      accepted: true,
      ignored: false,
      emailId: result.emailId,
      ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
      ...(result.t3ThreadId !== undefined ? { t3ThreadId: result.t3ThreadId } : {}),
      slackThreadTs: result.slackThreadTs,
    };
  },
});
