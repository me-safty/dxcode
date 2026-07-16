import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type CursorSettings, TextGenerationError } from "@t3tools/contracts";

import {
  applyCursorAcpModelSelection,
  makeCursorAcpRuntime,
} from "../provider/acp/CursorAcpSupport.ts";
import { makeAcpJsonTextGeneration } from "./AcpJsonTextGeneration.ts";
import type * as TextGeneration from "./TextGeneration.ts";

/**
 * Build a Cursor text-generation closure bound to a specific `CursorSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makeCursorTextGeneration = Effect.fn("makeCursorTextGeneration")(function* (
  cursorSettings: CursorSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  return makeAcpJsonTextGeneration({
    traceName: "CursorTextGeneration",
    requestLabel: "Cursor ACP",
    outputLabel: "Cursor Agent",
    makeRuntime: (cwd) =>
      makeCursorAcpRuntime({
        cursorSettings,
        environment: resolvedEnvironment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }),
    configureSession: ({ runtime, modelSelection, operation }) =>
      Effect.gen(function* () {
        yield* Effect.ignore(runtime.setMode("ask"));
        yield* applyCursorAcpModelSelection({
          runtime,
          model: modelSelection.model,
          selections: modelSelection.options,
          mapError: ({ cause, configId, step }) =>
            new TextGenerationError({
              operation,
              detail:
                step === "set-config-option"
                  ? `Failed to set Cursor ACP config option "${configId}" for text generation.`
                  : "Failed to set Cursor ACP base model for text generation.",
              cause,
            }),
        });
      }),
  }) satisfies TextGeneration.TextGeneration["Service"];
});
