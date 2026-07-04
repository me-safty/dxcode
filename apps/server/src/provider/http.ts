import { EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { expandHomePath } from "../pathExpansion.ts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexClient from "effect-codex-app-server/client";
import { resolveCodexProfileHomePath, scanCodexProfileHomes } from "./CodexAccountProfiles.ts";
import { resolveCodexBinaryPath } from "./CodexExecutable.ts";
import { normalizeCodexUsage } from "./CodexUsage.ts";

const CODEX_APP_SERVER_PROBE_FORCE_KILL_AFTER = 5000;

class CodexProfileNotAuthenticatedError extends Schema.TaggedErrorClass<CodexProfileNotAuthenticatedError>()(
  "CodexProfileNotAuthenticatedError",
  { homePath: Schema.String },
) {
  override get message(): string {
    return `Codex profile '${this.homePath}' is not signed in.`;
  }
}

export const providerHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "provider",
  Effect.fnUntraced(function* (handlers) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return handlers
      .handle(
        "probeCodexUsage",
        Effect.fn("environment.provider.probeCodexUsage")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          const { shadowHomePath, binaryPath } = args.payload;
          const resolvedHomePath =
            (yield* resolveCodexProfileHomePath(shadowHomePath)) ?? expandHomePath(shadowHomePath);
          const resolvedBinaryPath = yield* resolveCodexBinaryPath(binaryPath);
          const environment = {
            ...process.env,
            CODEX_HOME: resolvedHomePath,
          };

          return yield* Effect.gen(function* () {
            const spawnCommand = yield* resolveSpawnCommand(resolvedBinaryPath, ["app-server"], {
              env: environment,
              extendEnv: true,
            });

            const child = yield* spawner
              .spawn(
                ChildProcess.make(spawnCommand.command, spawnCommand.args, {
                  cwd: process.cwd(),
                  env: environment,
                  extendEnv: true,
                  forceKillAfter: CODEX_APP_SERVER_PROBE_FORCE_KILL_AFTER,
                  shell: spawnCommand.shell,
                }),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CodexErrors.CodexAppServerSpawnError({
                      command: `${resolvedBinaryPath} app-server`,
                      cause,
                    }),
                ),
              );

            const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
            const client = Context.get(clientContext, CodexClient.CodexAppServerClient);

            // initialize
            yield* client.request("initialize", {
              clientInfo: {
                name: "t3code_desktop",
                title: "T3 Code Desktop",
                version: "0.1.0",
              },
              capabilities: {
                experimentalApi: true,
              },
            });
            yield* client.notify("initialized", undefined);

            const accountResponse = yield* client.request("account/read", {});
            if (!accountResponse.account) {
              return yield* new CodexProfileNotAuthenticatedError({ homePath: resolvedHomePath });
            }
            const limitsResponse = yield* client.request("account/rateLimits/read", undefined);
            return normalizeCodexUsage({
              account: accountResponse.account,
              rateLimits: limitsResponse.rateLimits,
            });
          }).pipe(
            Effect.match({
              onFailure: (e) => ({
                status: "error" as const,
                resolvedHomePath,
                error: e instanceof Error ? e.message : String(e),
              }),
              onSuccess: (usage) => ({
                status: "success" as const,
                resolvedHomePath,
                usage,
              }),
            }),
          );
        }),
      )
      .handle(
        "loginCodexAccount",
        Effect.fn("environment.provider.loginCodexAccount")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          const { shadowHomePath, binaryPath } = args.payload;
          const resolvedHomePath = expandHomePath(shadowHomePath);
          const resolvedBinaryPath = yield* resolveCodexBinaryPath(binaryPath);
          const environment = {
            ...process.env,
            CODEX_HOME: resolvedHomePath,
          };

          return yield* Effect.gen(function* () {
            const spawnCommand = yield* resolveSpawnCommand(resolvedBinaryPath, ["login"], {
              env: environment,
              extendEnv: true,
            });

            const child = yield* spawner.spawn(
              ChildProcess.make(spawnCommand.command, spawnCommand.args, {
                cwd: process.cwd(),
                env: environment,
                extendEnv: true,
                shell: spawnCommand.shell,
              }),
            );

            const exitCode = yield* child.exitCode;

            if (exitCode !== 0) {
              return {
                status: "error" as const,
                error: `Codex login exited with code ${exitCode}`,
              };
            }

            return { status: "success" as const };
          }).pipe(
            Effect.match({
              onFailure: (e) => ({
                status: "error" as const,
                error: e instanceof Error ? e.message : String(e),
              }),
              onSuccess: (result) => result,
            }),
          );
        }),
      )
      .handle(
        "scanCodexProfiles",
        Effect.fn("environment.provider.scanCodexProfiles")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          const { basePath } = args.payload;
          return yield* scanCodexProfileHomes(basePath).pipe(
            Effect.map((profiles) => ({
              status: "success" as const,
              profiles,
            })),
            Effect.catch((error) =>
              Effect.succeed({
                status: "error" as const,
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
          );
        }),
      );
  }),
);
