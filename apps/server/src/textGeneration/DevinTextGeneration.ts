import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type DevinSettings, TextGenerationError } from "@t3tools/contracts";

import {
  applyDevinAcpModelSelection,
  currentDevinModelIdFromSessionSetup,
  makeDevinAcpRuntime,
  resolveDevinAcpModelSelection,
} from "../provider/acp/DevinAcpSupport.ts";
import { makeAcpJsonTextGeneration } from "./AcpJsonTextGeneration.ts";
import type * as TextGeneration from "./TextGeneration.ts";

export const makeDevinTextGeneration = Effect.fn("makeDevinTextGeneration")(function* (
  devinSettings: DevinSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return makeAcpJsonTextGeneration({
    traceName: "DevinTextGeneration",
    requestLabel: "Devin ACP",
    outputLabel: "Devin",
    makeRuntime: (cwd) =>
      makeDevinAcpRuntime({
        devinSettings,
        environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }),
    configureSession: ({ runtime, started, modelSelection, operation }) =>
      Effect.gen(function* () {
        yield* Effect.ignore(runtime.setMode("ask"));
        const resolvedModel = resolveDevinAcpModelSelection({
          configOptions: started.sessionSetupResult.configOptions,
          model: modelSelection.model,
          selections: modelSelection.options,
        });
        yield* applyDevinAcpModelSelection({
          runtime,
          currentModelId: currentDevinModelIdFromSessionSetup(started.sessionSetupResult),
          requestedModelId: resolvedModel,
          mapError: (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to set Devin ACP base model for text generation.",
              cause,
            }),
        });
      }),
  }) satisfies TextGeneration.TextGeneration["Service"];
});
