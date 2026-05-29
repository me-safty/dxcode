import * as Effect from "effect/Effect";

import { TextGenerationError } from "@t3tools/contracts";
import type { TextGenerationShape } from "./TextGeneration.ts";

export function makeUnsupportedTextGeneration(providerName: string): TextGenerationShape {
  const fail = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerName} does not support T3 Code text-generation operations yet.`,
      }),
    );

  return {
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  };
}
