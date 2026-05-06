import { NetService } from "@t3tools/shared/Net";
import type {
  DesktopSshEnvironmentBootstrap,
  DesktopDiscoveredSshHost,
  DesktopSshEnvironmentTarget,
  DesktopSshPasswordPromptRequest,
} from "@t3tools/contracts";
import {
  SshPasswordPrompt,
  type SshPasswordPromptShape,
  type SshPasswordRequest,
} from "@t3tools/ssh/auth";
import { discoverSshHosts } from "@t3tools/ssh/config";
import { SshPasswordPromptError } from "@t3tools/ssh/errors";
import { SshEnvironmentManager, type RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import {
  Cause,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Layer,
  Option,
  Path,
  Random,
  Scope,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { SSH_PASSWORD_PROMPT_CHANNEL } from "./ipc/channels.ts";

export { resolveRemoteT3CliPackageSpec } from "@t3tools/ssh/command";

const DEFAULT_SSH_PASSWORD_PROMPT_TIMEOUT_MS = 3 * 60 * 1000;

interface DesktopSshEnvironmentManagerOptions {
  readonly passwordProvider?: (
    request: SshPasswordRequest,
  ) => Effect.Effect<string | null, unknown>;
  readonly resolveCliPackageSpec?: () => string;
  readonly resolveCliRunner?: () => RemoteT3RunnerOptions;
}

export function discoverDesktopSshHostsEffect(input?: { readonly homeDir?: string }) {
  return discoverSshHosts(input ?? {});
}

export type DesktopSshEnvironmentEffectContext =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService;

export interface DesktopSshEnvironmentManagerShape {
  readonly discoverHosts: (input?: {
    readonly homeDir?: string;
  }) => Effect.Effect<
    readonly DesktopDiscoveredSshHost[],
    unknown,
    FileSystem.FileSystem | Path.Path
  >;
  readonly ensureEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ) => Effect.Effect<DesktopSshEnvironmentBootstrap, unknown, DesktopSshEnvironmentEffectContext>;
  readonly disconnectEnvironment: (
    target: DesktopSshEnvironmentTarget,
  ) => Effect.Effect<void, unknown, DesktopSshEnvironmentEffectContext>;
}

function makeDesktopSshPasswordPrompt(
  passwordProvider: DesktopSshEnvironmentManagerOptions["passwordProvider"],
): SshPasswordPromptShape {
  return {
    isAvailable: passwordProvider !== undefined,
    request: (request) => {
      if (!passwordProvider) {
        return Effect.succeed(null);
      }

      return passwordProvider(request).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new SshPasswordPromptError({
              message: "SSH password prompt failed.",
              cause: Cause.squash(cause),
            }),
          ),
        ),
      );
    },
  };
}

const makeDesktopSshEnvironmentManager = Effect.fn("desktop.ssh.manager.make")(function* (
  options: DesktopSshEnvironmentManagerOptions = {},
) {
  const manager = yield* SshEnvironmentManager;
  const bridge = yield* DesktopSshEnvironmentBridge;
  const passwordPrompt = SshPasswordPrompt.of(
    makeDesktopSshPasswordPrompt(options.passwordProvider ?? bridge.passwordProvider),
  );
  const withPasswordPrompt = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, SshPasswordPrompt>> =>
    effect.pipe(Effect.provideService(SshPasswordPrompt, passwordPrompt));

  return DesktopSshEnvironmentManager.of({
    discoverHosts: discoverDesktopSshHostsEffect,
    ensureEnvironment: (target, ensureOptions) =>
      withPasswordPrompt(manager.ensureEnvironment(target, ensureOptions)),
    disconnectEnvironment: (target) => withPasswordPrompt(manager.disconnectEnvironment(target)),
  });
});

export class DesktopSshEnvironmentManager extends Context.Service<
  DesktopSshEnvironmentManager,
  DesktopSshEnvironmentManagerShape
>()("@t3tools/desktop/DesktopSshEnvironmentManager") {
  static readonly layer = (options: DesktopSshEnvironmentManagerOptions = {}) =>
    Layer.effect(DesktopSshEnvironmentManager, makeDesktopSshEnvironmentManager(options)).pipe(
      Layer.provide(
        SshEnvironmentManager.layer({
          ...(options.resolveCliPackageSpec === undefined
            ? {}
            : { resolveCliPackageSpec: options.resolveCliPackageSpec }),
          ...(options.resolveCliRunner === undefined
            ? {}
            : { resolveCliRunner: options.resolveCliRunner }),
        }),
      ),
    );
}

/** Minimal subset of Electron's BrowserWindow used by the SSH bridge. */
export interface DesktopSshBridgeWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  readonly webContents: {
    send(channel: string, ...args: readonly unknown[]): void;
  };
}

export interface DesktopSshEnvironmentBridgeOptions {
  readonly getMainWindow: Effect.Effect<Option.Option<DesktopSshBridgeWindow>, never>;
  readonly passwordPromptTimeoutMs?: number;
}

interface PendingSshPasswordPrompt {
  readonly deferred: Deferred.Deferred<string | null, Error>;
  readonly timeoutFiber: Fiber.Fiber<void, never>;
}

export function isSshPasswordPromptCancellation(error: unknown): error is SshPasswordPromptError {
  const message = error instanceof SshPasswordPromptError ? error.message.toLowerCase() : "";
  return (
    error instanceof SshPasswordPromptError &&
    (message.includes("cancelled") || message.includes("timed out"))
  );
}

export interface DesktopSshEnvironmentBridgeShape {
  readonly installPasswordPromptScope: (scope: Scope.Closeable) => Effect.Effect<void>;
  readonly passwordProvider: (request: SshPasswordRequest) => Effect.Effect<string | null, Error>;
  readonly resolvePasswordPrompt: (
    requestId: string,
    password: string | null,
  ) => Effect.Effect<void, Error>;
  readonly cancelPendingPasswordPromptsEffect: (reason: string) => Effect.Effect<void>;
  readonly disposeEffect: () => Effect.Effect<void>;
}

/**
 * Owns renderer-facing SSH password prompt state so the manager can request
 * credentials without depending on Electron IPC details.
 */
function makeDesktopSshEnvironmentBridge(
  options: DesktopSshEnvironmentBridgeOptions,
): DesktopSshEnvironmentBridgeShape {
  let passwordPromptScope: Option.Option<Scope.Closeable> = Option.none();
  const pendingPrompts = new Map<string, PendingSshPasswordPrompt>();
  const passwordPromptTimeoutMs =
    options.passwordPromptTimeoutMs ?? DEFAULT_SSH_PASSWORD_PROMPT_TIMEOUT_MS;
  let disposed = false;

  const cancelPendingPasswordPromptsEffect = (reason: string): Effect.Effect<void> => {
    const prompts = Array.from(pendingPrompts);
    pendingPrompts.clear();
    return Effect.forEach(
      prompts,
      ([, pending]) =>
        Fiber.interrupt(pending.timeoutFiber).pipe(
          Effect.ignore,
          Effect.andThen(Deferred.fail(pending.deferred, new Error(reason))),
          Effect.asVoid,
        ),
      { discard: true },
    ).pipe(Effect.asVoid);
  };

  const resolvePasswordPromptEffect = (
    requestId: string,
    password: string | null,
  ): Effect.Effect<void, Error> => {
    if (requestId.trim().length === 0) {
      return Effect.fail(new Error("Invalid SSH password prompt id."));
    }

    const pending = pendingPrompts.get(requestId);
    if (!pending) {
      return Effect.fail(new Error("SSH password prompt expired. Try connecting again."));
    }

    pendingPrompts.delete(requestId);
    return Fiber.interrupt(pending.timeoutFiber).pipe(
      Effect.ignore,
      Effect.andThen(Deferred.succeed(pending.deferred, password)),
      Effect.asVoid,
    );
  };

  const requestPasswordFromRendererEffect = (
    input: SshPasswordRequest,
  ): Effect.Effect<string | null, Error> => {
    const scope = Option.getOrUndefined(passwordPromptScope);
    if (scope === undefined) {
      return Effect.fail(new Error("SSH password prompt scope has not been initialized."));
    }

    return Effect.gen(function* () {
      const window = Option.getOrUndefined(yield* options.getMainWindow);
      if (!window || window.isDestroyed()) {
        return yield* Effect.fail(
          new Error("T3 Code window is not available for SSH authentication."),
        );
      }

      const requestId = yield* Random.nextUUIDv4;
      const now = yield* DateTime.now;
      const request: DesktopSshPasswordPromptRequest = {
        requestId,
        destination: input.destination,
        username: input.username,
        prompt: input.prompt,
        expiresAt: DateTime.formatIso(DateTime.add(now, { milliseconds: passwordPromptTimeoutMs })),
      };
      const deferred = yield* Deferred.make<string | null, Error>();
      const timeoutFiber = yield* Effect.sleep(Duration.millis(passwordPromptTimeoutMs)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            pendingPrompts.delete(request.requestId);
          }),
        ),
        Effect.andThen(
          Deferred.fail(
            deferred,
            new Error(`SSH authentication timed out for ${input.destination}.`),
          ),
        ),
        Effect.asVoid,
        Effect.forkIn(scope),
      );

      pendingPrompts.set(request.requestId, { deferred, timeoutFiber });

      yield* Effect.try({
        try: () => {
          if (window.isDestroyed()) {
            throw new Error("T3 Code window is not available for SSH authentication.");
          }
          window.webContents.send(SSH_PASSWORD_PROMPT_CHANNEL, request);
          if (window.isDestroyed()) {
            throw new Error("T3 Code window is not available for SSH authentication.");
          }
          if (window.isMinimized()) {
            window.restore();
          }
          if (window.isDestroyed()) {
            throw new Error("T3 Code window is not available for SSH authentication.");
          }
          window.focus();
        },
        catch: (error) =>
          error instanceof Error
            ? error
            : new Error("T3 Code window is not available for SSH authentication."),
      }).pipe(
        Effect.catch((error) =>
          Effect.fail(error).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                pendingPrompts.delete(request.requestId);
              }).pipe(Effect.andThen(Fiber.interrupt(timeoutFiber).pipe(Effect.ignore))),
            ),
          ),
        ),
      );

      return yield* Deferred.await(deferred).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pendingPrompts.delete(request.requestId);
          }).pipe(Effect.andThen(Fiber.interrupt(timeoutFiber).pipe(Effect.ignore))),
        ),
      );
    });
  };

  return {
    installPasswordPromptScope: (scope) =>
      Effect.sync(() => {
        passwordPromptScope = Option.some(scope);
      }),
    passwordProvider: requestPasswordFromRendererEffect,
    resolvePasswordPrompt: resolvePasswordPromptEffect,
    cancelPendingPasswordPromptsEffect,
    disposeEffect: () => {
      if (disposed) return Effect.void;
      disposed = true;
      const scope = passwordPromptScope;
      passwordPromptScope = Option.none();
      return cancelPendingPasswordPromptsEffect("SSH environment bridge disposed.").pipe(
        Effect.andThen(
          Option.match(scope, {
            onNone: () => Effect.void,
            onSome: (scope) => Scope.close(scope, Exit.void),
          }),
        ),
        Effect.ignore,
      );
    },
  };
}

export class DesktopSshEnvironmentBridge extends Context.Service<
  DesktopSshEnvironmentBridge,
  DesktopSshEnvironmentBridgeShape
>()("@t3tools/desktop/DesktopSshEnvironmentBridge") {
  static readonly layer = (options: DesktopSshEnvironmentBridgeOptions) =>
    Layer.succeed(
      DesktopSshEnvironmentBridge,
      DesktopSshEnvironmentBridge.of(makeDesktopSshEnvironmentBridge(options)),
    );
}
