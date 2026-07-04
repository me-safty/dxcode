// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";

export function codexBinaryCandidates(
  configuredBinaryPath: string,
  platform: NodeJS.Platform,
  homeDirectory = NodeOS.homedir(),
): ReadonlyArray<string> {
  const configured = configuredBinaryPath.trim() || "codex";
  if (configured !== "codex" || platform !== "darwin") return [configured];

  return [
    configured,
    "/Applications/Codex.app/Contents/Resources/codex",
    NodePath.join(homeDirectory, "Applications/Codex.app/Contents/Resources/codex"),
  ];
}

/** Resolve the Codex Desktop bundled CLI when a GUI-launched server has no `codex` on PATH. */
export const resolveCodexBinaryPath = Effect.fn("CodexExecutable.resolveCodexBinaryPath")(
  function* (configuredBinaryPath: string, environment: NodeJS.ProcessEnv = process.env) {
    const platform = yield* HostProcessPlatform;
    const candidates = codexBinaryCandidates(configuredBinaryPath, platform);
    for (const candidate of candidates) {
      if (yield* isCommandAvailable(candidate, { env: environment, extendEnv: true })) {
        return candidate;
      }
    }
    return candidates[0] ?? "codex";
  },
);
