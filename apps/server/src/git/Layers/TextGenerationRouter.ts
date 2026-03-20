/**
 * TextGenerationRouter – Routes text-generation requests to either the Codex
 * (OpenAI) or Claude backend based on the model slug supplied in each call.
 *
 * A model slug starting with "claude-" is dispatched to ClaudeTextGeneration;
 * everything else goes to CodexTextGeneration.
 *
 * @module TextGenerationRouter
 */
import { Effect, Layer } from "effect";

import { isClaudeModelSlug } from "@t3tools/contracts";

import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import { makeCodexTextGenerationShape } from "./CodexTextGeneration.ts";
import { makeClaudeTextGenerationShape } from "./ClaudeTextGeneration.ts";

/**
 * Live layer that provides the `TextGeneration` service by routing each call
 * to the appropriate backend (Codex or Claude) based on the requested model.
 *
 * The Codex shape requires Effect context (FileSystem, Path, etc.) so we
 * yield it; the Claude shape is pure so we just call its factory.
 */
export const TextGenerationRouterLive = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const codex = yield* makeCodexTextGenerationShape;
    const claude = makeClaudeTextGenerationShape();

    const pick = (operation: string, model?: string): TextGenerationShape => {
      const isClaude = model && isClaudeModelSlug(model);
      const backend = isClaude ? "Claude" : "Codex";
      console.log(
        `[TextGeneration] ${operation} → backend=${backend}, model=${model ?? "(default)"}`,
      );
      return isClaude ? claude : codex;
    };

    return {
      generateCommitMessage: (input) =>
        pick("generateCommitMessage", input.model).generateCommitMessage(input),
      generatePrContent: (input) => pick("generatePrContent", input.model).generatePrContent(input),
      generateBranchName: (input) =>
        pick("generateBranchName", input.model).generateBranchName(input),
    } satisfies TextGenerationShape;
  }),
);
