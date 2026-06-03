import { type GrokBuildSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES } from "../Layers/CursorProvider.ts";
import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";
import {
  applyCursorAcpModelSelection,
  type CursorAcpModelSelectionErrorContext,
} from "./CursorAcpSupport.ts";

type GrokAcpRuntimeSettings = Pick<GrokBuildSettings, "binaryPath">;

export interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokBuildSettings: GrokAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export type GrokAcpModelSelectionErrorContext = CursorAcpModelSelectionErrorContext;

export function buildGrokAcpSpawnInput(
  grokBuildSettings: GrokAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  // T3 Code already resolves the effective workspace for each thread. When a
  // thread runs in a dedicated git worktree, `cwd` is that worktree path, so
  // we intentionally do not pass Grok's own `--worktree` flag here.
  return {
    command: grokBuildSettings?.binaryPath || "grok",
    args: ["--agent", "build", "agent", "stdio"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(input.grokBuildSettings, input.cwd, input.environment),
        authMethodId: "grok_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

export const applyGrokAcpModelSelection = applyCursorAcpModelSelection;
