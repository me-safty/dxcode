import { Effect, Layer, Schema } from "effect";

import {
  type CodexReasoningEffort,
  type CopilotModelSelection,
  type ChatAttachment,
} from "@t3tools/contracts";
import {
  approveAll,
  CopilotClient,
  type CopilotClientOptions,
  type ModelInfo,
  type SessionEvent,
} from "@github/copilot-sdk";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  normalizeCopilotCliPathOverride,
  resolveBundledCopilotCliPath,
} from "../../provider/Layers/copilotCliPath.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
} from "../Prompts.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import { normalizeCliError, sanitizeCommitSubject, sanitizePrTitle } from "../Utils.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const COPILOT_GIT_TEXT_GENERATION_REASONING_EFFORT = "low" as const;
const COPILOT_TIMEOUT_MS = 180_000;

export interface CopilotTextGenerationLiveOptions {
  readonly clientFactory?: (options: CopilotClientOptions) => CopilotTextGenerationClientHandle;
}

interface CopilotTextGenerationSessionHandle {
  send(options: {
    prompt: string;
    attachments?: Array<{ type: "file"; path: string; displayName?: string }>;
    mode?: "enqueue" | "immediate";
  }): Promise<string>;
  getMessages(): Promise<ReadonlyArray<SessionEvent>>;
  destroy(): Promise<void>;
}

interface CopilotTextGenerationClientHandle {
  start(): Promise<void>;
  stop(): Promise<ReadonlyArray<Error>>;
  listModels(): Promise<ReadonlyArray<ModelInfo>>;
  createSession(config: {
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    workingDirectory?: string;
    configDir?: string;
    streaming?: boolean;
    onEvent?: (event: SessionEvent) => void;
    onPermissionRequest?: unknown;
  }): Promise<CopilotTextGenerationSessionHandle>;
}

function mapSupportedModelsById(models: ReadonlyArray<ModelInfo>) {
  return new Map(models.map((model) => [model.id, model]));
}

function buildStrictJsonPrompt(prompt: string): string {
  return `${prompt}\n\nReturn only valid JSON. Do not include markdown fences or explanatory text.`;
}

function findLastAssistantMessage(events: ReadonlyArray<SessionEvent>): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "assistant.message") {
      const content = event.data.content.trim();
      if (content.length > 0) {
        return content;
      }
    }
  }
  return null;
}

function extractJsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates = new Set<string>();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    candidates.add(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return [...candidates];
}

function decodeStructuredOutput<
  S extends Schema.Top & {
    readonly DecodingServices: never;
  },
>(input: {
  operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
  content: string;
  outputSchema: S;
}): Effect.Effect<S["Type"], TextGenerationError> {
  const decode = Schema.decodeUnknownSync(input.outputSchema);

  return Effect.try({
    try: () => {
      for (const candidate of extractJsonCandidates(input.content)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(candidate);
        } catch {
          continue;
        }

        try {
          return decode(parsed);
        } catch {
          continue;
        }
      }

      throw new TextGenerationError({
        operation: input.operation,
        detail: "GitHub Copilot returned invalid structured output.",
      });
    },
    catch: (cause) =>
      Schema.is(TextGenerationError)(cause)
        ? cause
        : new TextGenerationError({
            operation: input.operation,
            detail: "GitHub Copilot returned invalid structured output.",
            cause,
          }),
  });
}

function materializeCopilotAttachments(
  attachmentsDir: string,
  attachments: ReadonlyArray<ChatAttachment> | undefined,
): Array<{ type: "file"; path: string; displayName?: string }> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const results: Array<{ type: "file"; path: string; displayName?: string }> = [];
  for (const attachment of attachments) {
    const resolvedPath = resolveAttachmentPath({
      attachmentsDir,
      attachment,
    });
    if (!resolvedPath) {
      continue;
    }
    results.push({
      type: "file",
      path: resolvedPath,
      displayName: attachment.name,
    });
  }
  return results;
}

const makeCopilotTextGeneration = (options?: CopilotTextGenerationLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const serverSettingsService = yield* Effect.service(ServerSettingsService);

    const runCopilotJson = <
      S extends Schema.Top & {
        readonly DecodingServices: never;
      },
    >(input: {
      operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
      cwd: string;
      prompt: string;
      outputSchema: S;
      modelSelection: CopilotModelSelection;
      attachments?: ReadonlyArray<ChatAttachment>;
    }): Effect.Effect<S["Type"], TextGenerationError> =>
      Effect.gen(function* () {
        const copilotSettings = yield* serverSettingsService.getSettings.pipe(
          Effect.map((settings) => settings.providers.copilot),
          Effect.mapError((cause) =>
            normalizeCliError(
              "copilot",
              input.operation,
              cause,
              "Failed to load GitHub Copilot settings",
            ),
          ),
        );
        const cliPath =
          normalizeCopilotCliPathOverride(copilotSettings.binaryPath) ??
          resolveBundledCopilotCliPath();
        return yield* Effect.acquireUseRelease(
          Effect.sync(
            () =>
              options?.clientFactory?.({
                ...(cliPath ? { cliPath } : {}),
                ...(input.cwd ? { cwd: input.cwd } : {}),
                logLevel: "error",
              }) ??
              new CopilotClient({
                ...(cliPath ? { cliPath } : {}),
                ...(input.cwd ? { cwd: input.cwd } : {}),
                logLevel: "error",
              }),
          ),
          (client) =>
            Effect.gen(function* () {
              const supportedModels = mapSupportedModelsById(
                yield* Effect.tryPromise({
                  try: async () => {
                    await client.start();
                    return await client.listModels();
                  },
                  catch: (cause) =>
                    normalizeCliError(
                      "copilot",
                      input.operation,
                      cause,
                      "Failed to start GitHub Copilot client",
                    ),
                }),
              );
              const selectedModel = supportedModels.get(input.modelSelection.model);
              if (!selectedModel) {
                return yield* new TextGenerationError({
                  operation: input.operation,
                  detail: `GitHub Copilot model '${input.modelSelection.model}' is not available in the current Copilot runtime.`,
                });
              }

              const explicitReasoningEffort = input.modelSelection.options?.reasoningEffort;
              const effectiveReasoningEffort =
                explicitReasoningEffort ??
                (selectedModel.supportedReasoningEfforts?.includes(
                  COPILOT_GIT_TEXT_GENERATION_REASONING_EFFORT,
                )
                  ? COPILOT_GIT_TEXT_GENERATION_REASONING_EFFORT
                  : undefined);

              if (explicitReasoningEffort) {
                const supportedReasoningEfforts = selectedModel.supportedReasoningEfforts ?? [];
                if (supportedReasoningEfforts.length === 0) {
                  return yield* new TextGenerationError({
                    operation: input.operation,
                    detail: `GitHub Copilot model '${selectedModel.id}' does not support reasoning effort configuration.`,
                  });
                }
                if (!supportedReasoningEfforts.includes(explicitReasoningEffort)) {
                  return yield* new TextGenerationError({
                    operation: input.operation,
                    detail: `GitHub Copilot model '${selectedModel.id}' does not support reasoning effort '${explicitReasoningEffort}'.`,
                  });
                }
              }

              const attachments = materializeCopilotAttachments(
                serverConfig.attachmentsDir,
                input.attachments,
              );
              const rawOutput = yield* Effect.tryPromise({
                try: async () => {
                  let activeTurnStarted = false;
                  let latestAssistantMessage: string | null = null;
                  let resolveTurnEnd: (() => void) | undefined;
                  const turnEnded = new Promise<void>((resolve) => {
                    resolveTurnEnd = resolve;
                  });
                  const session = await client.createSession({
                    onPermissionRequest: approveAll,
                    model: input.modelSelection.model,
                    ...(effectiveReasoningEffort
                      ? { reasoningEffort: effectiveReasoningEffort }
                      : {}),
                    ...(input.cwd ? { workingDirectory: input.cwd } : {}),
                    ...(copilotSettings.configDir ? { configDir: copilotSettings.configDir } : {}),
                    streaming: false,
                    onEvent: (event) => {
                      if (event.type === "assistant.turn_start") {
                        activeTurnStarted = true;
                        return;
                      }
                      if (event.type === "assistant.message" && activeTurnStarted) {
                        latestAssistantMessage = event.data.content;
                        return;
                      }
                      if (event.type === "assistant.turn_end" && activeTurnStarted) {
                        resolveTurnEnd?.();
                      }
                    },
                  });

                  try {
                    await session.send({
                      prompt: buildStrictJsonPrompt(input.prompt),
                      ...(attachments.length > 0 ? { attachments } : {}),
                      mode: "immediate",
                    });
                    await Promise.race([
                      turnEnded,
                      new Promise<void>((_, reject) => {
                        setTimeout(() => {
                          reject(new Error("GitHub Copilot request timed out."));
                        }, COPILOT_TIMEOUT_MS);
                      }),
                    ]);

                    if (!latestAssistantMessage) {
                      latestAssistantMessage = findLastAssistantMessage(
                        await session.getMessages(),
                      );
                    }
                    if (!latestAssistantMessage || latestAssistantMessage.trim().length === 0) {
                      throw new Error("GitHub Copilot returned an empty response.");
                    }
                    return latestAssistantMessage;
                  } finally {
                    await session.destroy().catch(() => undefined);
                  }
                },
                catch: (cause) =>
                  normalizeCliError(
                    "copilot",
                    input.operation,
                    cause,
                    "GitHub Copilot request failed",
                  ),
              });

              return yield* decodeStructuredOutput({
                operation: input.operation,
                content: rawOutput,
                outputSchema: input.outputSchema,
              });
            }),
          (client) =>
            Effect.promise(() =>
              client
                .stop()
                .then(() => undefined)
                .catch(() => undefined),
            ),
        );
      });

    const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
      "CopilotTextGeneration.generateCommitMessage",
    )(function* (input) {
      if (input.modelSelection.provider !== "copilot") {
        return yield* new TextGenerationError({
          operation: "generateCommitMessage",
          detail: "Invalid model selection.",
        });
      }
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const generated = yield* runCopilotJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

    const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
      "CopilotTextGeneration.generatePrContent",
    )(function* (input) {
      if (input.modelSelection.provider !== "copilot") {
        return yield* new TextGenerationError({
          operation: "generatePrContent",
          detail: "Invalid model selection.",
        });
      }
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });
      const generated = yield* runCopilotJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

    const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
      "CopilotTextGeneration.generateBranchName",
    )(function* (input) {
      if (input.modelSelection.provider !== "copilot") {
        return yield* new TextGenerationError({
          operation: "generateBranchName",
          detail: "Invalid model selection.",
        });
      }
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runCopilotJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

    return {
      generateCommitMessage,
      generatePrContent,
      generateBranchName,
    } satisfies TextGenerationShape;
  });

export const CopilotTextGenerationLive = Layer.effect(TextGeneration, makeCopilotTextGeneration());

export function makeCopilotTextGenerationLive(options?: CopilotTextGenerationLiveOptions) {
  return Layer.effect(TextGeneration, makeCopilotTextGeneration(options));
}
