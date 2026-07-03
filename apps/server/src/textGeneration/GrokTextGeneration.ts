import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type GrokSettings, TextGenerationError } from "@t3tools/contracts";

import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../provider/acp/GrokAcpSupport.ts";
import { makeAcpJsonTextGeneration } from "./AcpJsonTextGeneration.ts";
import type * as TextGeneration from "./TextGeneration.ts";

export const makeGrokTextGeneration = Effect.fn("makeGrokTextGeneration")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return makeAcpJsonTextGeneration({
    traceName: "GrokTextGeneration",
    requestLabel: "Grok ACP",
    outputLabel: "Grok Agent",
    makeRuntime: (cwd) =>
      makeGrokAcpRuntime({
        grokSettings,
        environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }),
    configureSession: ({ runtime, started, modelSelection, operation }) =>
      applyGrokAcpModelSelection({
        runtime,
        currentModelId: currentGrokModelIdFromSessionSetup(started.sessionSetupResult),
        requestedModelId: resolveGrokAcpBaseModelId(modelSelection.model),
        mapError: (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to set Grok ACP base model for text generation.",
            cause,
          }),
      }).pipe(Effect.asVoid),
  }) satisfies TextGeneration.TextGeneration["Service"];
});
