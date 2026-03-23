import { ServiceMap, Effect } from "effect";
import type { GmailMessage } from "@t3tools/contracts";
import type { GmailError } from "../Errors.ts";

export interface GmailServiceShape {
  readonly search: (input: { query: string; maxResults?: number }) => Effect.Effect<ReadonlyArray<GmailMessage>, GmailError>;
  readonly markRead: (input: { threadId: string }) => Effect.Effect<void, GmailError>;
  readonly createDraft: (input: { to: string; subject: string; body: string; replyToMessageId?: string }) => Effect.Effect<{ id: string }, GmailError>;
}

export class GmailService extends ServiceMap.Service<GmailService, GmailServiceShape>()(
  "t3/gmail/Services/GmailService",
) {}
