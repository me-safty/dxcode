import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const GmailCategory = Schema.Literals(["ACTION", "REVIEW", "FYI", "NOISE"]);
export type GmailCategory = typeof GmailCategory.Type;

export const GmailMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: TrimmedNonEmptyString,
  from: TrimmedNonEmptyString,
  subject: Schema.String,
  snippet: Schema.String,
  date: Schema.String,
  isUnread: Schema.Boolean,
  category: Schema.optional(GmailCategory),
});
export type GmailMessage = typeof GmailMessage.Type;

export const GmailSearchInput = Schema.Struct({
  query: TrimmedNonEmptyString,
  maxResults: Schema.optional(Schema.Number),
});
export type GmailSearchInput = typeof GmailSearchInput.Type;

export const GmailMarkReadInput = Schema.Struct({
  threadId: TrimmedNonEmptyString,
});
export type GmailMarkReadInput = typeof GmailMarkReadInput.Type;

export const GmailCreateDraftInput = Schema.Struct({
  to: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  replyToMessageId: Schema.optional(TrimmedNonEmptyString),
});
export type GmailCreateDraftInput = typeof GmailCreateDraftInput.Type;

export const GMAIL_WS_METHODS = {
  gmailSearch: "gmail.search",
  gmailMarkRead: "gmail.markRead",
  gmailCreateDraft: "gmail.createDraft",
} as const;
