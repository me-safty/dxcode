/**
 * ClaudeTextGeneration – Text generation layer that uses the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`) for git content generation (commit
 * messages, PR titles/bodies, branch names).
 *
 * @module ClaudeTextGeneration
 */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { Effect, Layer, Schema } from "effect";

import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const DEFAULT_CLAUDE_GIT_MODEL = "claude-haiku-4-5";
const CLAUDE_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) return "Update project files";
  return withoutTrailingPeriod.length <= 72
    ? withoutTrailingPeriod
    : withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  return singleLine.length > 0 ? singleLine : "Update project changes";
}

/**
 * Run a one-shot Claude query and extract JSON from the response.
 */
async function runClaudeJson<T>(options: {
  operation: string;
  model: string;
  prompt: string;
  cwd: string;
}): Promise<T> {
  const { operation, model, prompt, cwd } = options;

  const messages = query({
    prompt,
    options: {
      model,
      cwd,
      persistSession: false,
      tools: [],
      permissionMode: "bypassPermissions",
      maxTurns: 1,
    },
  });

  let resultText: string | null = null;
  let errorText: string | null = null;

  for await (const message of messages) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        errorText = message.errors?.join("\n") ?? "Unknown error";
      }
    }
  }

  if (errorText || !resultText) {
    throw new TextGenerationError({
      operation,
      detail: errorText ?? "Claude returned no result text.",
    });
  }

  // Extract JSON from the response (may be wrapped in markdown code fences).
  const jsonMatch =
    resultText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? resultText.match(/(\{[\s\S]*\})/);
  const jsonString = jsonMatch?.[1]?.trim() ?? resultText.trim();

  try {
    return JSON.parse(jsonString) as T;
  } catch {
    throw new TextGenerationError({
      operation,
      detail: `Failed to parse JSON from Claude response: ${jsonString.slice(0, 200)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Layer implementation
// ---------------------------------------------------------------------------

/** Exported so that the router layer can create the shape without going through the Layer system. */
export function makeClaudeTextGenerationShape(): TextGenerationShape {
  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const model = input.model ?? DEFAULT_CLAUDE_GIT_MODEL;
        const wantsBranch = input.includeBranch === true;

        const recentCommitsSection = input.recentCommitSubjects
          ? [
              "Recent commits in this repo (match this style closely):",
              limitSection(input.recentCommitSubjects, 2_000),
              "",
              "IMPORTANT: Your subject line MUST follow the same format, casing, and prefix conventions as the recent commits above.",
            ]
          : [];

        const prompt = [
          "You write concise git commit messages.",
          wantsBranch
            ? "Return a JSON object with keys: subject, body, branch."
            : "Return a JSON object with keys: subject, body.",
          "Rules:",
          "- subject must be a single line, imperative, <= 72 chars, and no trailing period",
          "- body must be an empty string (no multi-line commit messages)",
          ...(wantsBranch
            ? ["- branch must be a short semantic git branch fragment for this change"]
            : []),
          "- capture the primary user-visible or developer-visible change",
          "- match the commit message style of the repository (see recent commits below if available)",
          "- Output ONLY the JSON object, no markdown fences.",
          ...recentCommitsSection,
          "",
          `Branch: ${input.branch ?? "(detached)"}`,
          "",
          "Staged files:",
          limitSection(input.stagedSummary, 6_000),
          "",
          "Staged patch:",
          limitSection(input.stagedPatch, 40_000),
        ].join("\n");

        const generated = await runClaudeJson<{
          subject: string;
          body: string;
          branch?: string;
        }>({
          operation: "generateCommitMessage",
          model,
          prompt,
          cwd: input.cwd,
        });

        return {
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...(wantsBranch && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        } satisfies CommitMessageGenerationResult;
      },
      catch: (error) =>
        Schema.is(TextGenerationError)(error)
          ? error
          : new TextGenerationError({
              operation: "generateCommitMessage",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
    });

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const model = input.model ?? DEFAULT_CLAUDE_GIT_MODEL;
        const prompt = [
          "You write GitHub pull request content.",
          "Return a JSON object with keys: title, body.",
          "Rules:",
          "- title should be concise and specific",
          "- body must be markdown and include headings '## Summary' and '## Testing'",
          "- under Summary, provide short bullet points",
          "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
          "- Output ONLY the JSON object, no markdown fences.",
          "",
          `Base branch: ${input.baseBranch}`,
          `Head branch: ${input.headBranch}`,
          "",
          "Commits:",
          limitSection(input.commitSummary, 12_000),
          "",
          "Diff stat:",
          limitSection(input.diffSummary, 12_000),
          "",
          "Diff patch:",
          limitSection(input.diffPatch, 40_000),
        ].join("\n");

        const generated = await runClaudeJson<{ title: string; body: string }>({
          operation: "generatePrContent",
          model,
          prompt,
          cwd: input.cwd,
        });

        return {
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        } satisfies PrContentGenerationResult;
      },
      catch: (error) =>
        Schema.is(TextGenerationError)(error)
          ? error
          : new TextGenerationError({
              operation: "generatePrContent",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
    });

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const model = input.model ?? DEFAULT_CLAUDE_GIT_MODEL;
        const attachmentLines = (input.attachments ?? []).map(
          (a) => `- ${a.name} (${a.mimeType}, ${a.sizeBytes} bytes)`,
        );

        const promptSections = [
          "You generate concise git branch names.",
          "Return a JSON object with key: branch.",
          "Rules:",
          "- Branch should describe the requested work from the user message.",
          "- Keep it short and specific (2-6 words).",
          "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
          "- Output ONLY the JSON object, no markdown fences.",
          "",
          "User message:",
          limitSection(input.message, 8_000),
        ];

        if (attachmentLines.length > 0) {
          promptSections.push(
            "",
            "Attachment metadata:",
            limitSection(attachmentLines.join("\n"), 4_000),
          );
        }

        const generated = await runClaudeJson<{ branch: string }>({
          operation: "generateBranchName",
          model,
          prompt: promptSections.join("\n"),
          cwd: input.cwd,
        });

        return {
          branch: sanitizeBranchFragment(generated.branch),
        } satisfies BranchNameGenerationResult;
      },
      catch: (error) =>
        Schema.is(TextGenerationError)(error)
          ? error
          : new TextGenerationError({
              operation: "generateBranchName",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
  } satisfies TextGenerationShape;
}

export const ClaudeTextGenerationLive = Layer.effect(
  TextGeneration,
  Effect.sync(() => makeClaudeTextGenerationShape()),
);
