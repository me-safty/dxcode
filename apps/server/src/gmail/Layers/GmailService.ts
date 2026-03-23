import { Effect, Layer } from "effect";
import { execSync } from "node:child_process";
import { GmailService } from "../Services/GmailService.ts";
import { GmailError } from "../Errors.ts";
import type { GmailMessage } from "@t3tools/contracts";

const ACCOUNT = "tryan@mediafly.com";

function runGogcli(args: string): Effect.Effect<string, GmailError> {
  return Effect.try({
    try: () => execSync(`gogcli ${args}`, { encoding: "utf-8", timeout: 30000 }),
    catch: (e) => new GmailError({ message: `gogcli failed: ${e}` }),
  });
}

function categorizeEmail(from: string, subject: string): "ACTION" | "REVIEW" | "FYI" | "NOISE" {
  const lowerSubject = subject.toLowerCase();
  const lowerFrom = from.toLowerCase();

  // Noise patterns
  if (lowerFrom.includes("noreply") || lowerFrom.includes("no-reply")) return "NOISE";
  if (lowerSubject.includes("[resolved]")) return "NOISE";
  if (lowerFrom.includes("grafana") && lowerSubject.includes("[ok]")) return "NOISE";
  if (lowerFrom.includes("jira@mediafly") || lowerFrom.includes("atlassian")) return "NOISE";
  if (lowerFrom.includes("salesforce")) return "NOISE";

  // Review patterns
  if (lowerSubject.includes("review requested") || lowerSubject.includes("pull request")) return "REVIEW";
  if (lowerFrom.includes("github.com")) return "REVIEW";

  // Action patterns
  if (lowerSubject.includes("action required") || lowerSubject.includes("urgent")) return "ACTION";

  return "FYI";
}

function parseGogcliOutput(output: string): GmailMessage[] {
  // gogcli json output returns an array of message objects
  try {
    const messages = JSON.parse(output);
    if (!Array.isArray(messages)) return [];
    return messages.map((m: any) => ({
      id: m.id ?? m.messageId ?? "",
      threadId: m.threadId ?? "",
      from: m.from ?? "",
      subject: m.subject ?? "",
      snippet: m.snippet ?? "",
      date: m.date ?? m.internalDate ?? "",
      isUnread: m.labelIds?.includes("UNREAD") ?? true,
      category: categorizeEmail(m.from ?? "", m.subject ?? ""),
    }));
  } catch {
    // Fallback: parse plain text output
    return output.split("\n").filter(Boolean).map((line, i) => ({
      id: `msg-${i}`,
      threadId: `thread-${i}`,
      from: "",
      subject: line.trim(),
      snippet: "",
      date: new Date().toISOString(),
      isUnread: true,
    }));
  }
}

export const GmailServiceLive = Layer.succeed(
  GmailService,
  GmailService.of({
    search: ({ query, maxResults }) =>
      Effect.gen(function* () {
        const max = maxResults ?? 50;
        const output = yield* runGogcli(
          `gmail search "${query}" --account ${ACCOUNT} --json --max ${max}`,
        );
        return parseGogcliOutput(output);
      }),

    markRead: ({ threadId }) =>
      runGogcli(
        `gmail thread modify ${threadId} --remove UNREAD --account ${ACCOUNT} --force`,
      ).pipe(Effect.asVoid),

    createDraft: ({ to, subject, body, replyToMessageId }) =>
      Effect.gen(function* () {
        const replyArg = replyToMessageId ? ` --reply-to-message-id "${replyToMessageId}"` : "";
        yield* runGogcli(
          `gmail drafts create --account ${ACCOUNT} --to "${to}" --subject "${subject}" --body "${body}"${replyArg}`,
        );
        return { id: crypto.randomUUID() };
      }),
  }),
);
