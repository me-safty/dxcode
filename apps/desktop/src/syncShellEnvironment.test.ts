import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger, Option, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  DesktopShellEnvironment,
  DesktopShellEnvironmentConfig,
  DesktopShellEnvironmentLive,
  DesktopShellEnvironmentProbe,
  DesktopShellEnvironmentProbeLive,
  type DesktopShellEnvironmentProbeShape,
  type WindowsEnvironmentProbeOptions,
} from "./syncShellEnvironment.ts";

const textEncoder = new TextEncoder();
const LOGIN_SHELL_ENV_NAMES = [
  "PATH",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

function makeProcess(options?: {
  readonly stdout?: Stream.Stream<Uint8Array>;
  readonly stderr?: Stream.Stream<Uint8Array>;
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
}): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: options?.stdout ?? Stream.empty,
    stderr: options?.stderr ?? Stream.empty,
    all: Stream.merge(options?.stdout ?? Stream.empty, options?.stderr ?? Stream.empty),
    exitCode: options?.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

const defaultProbe: DesktopShellEnvironmentProbeShape = {
  readLoginShellEnvironment: () => Effect.succeed({}),
  readLaunchctlPath: Effect.succeed(Option.none()),
  readWindowsShellEnvironment: () => Effect.succeed({}),
  isWindowsCommandAvailable: () => Effect.succeed(true),
};

function probeLayer(probe: Partial<DesktopShellEnvironmentProbeShape>) {
  return Layer.succeed(DesktopShellEnvironmentProbe, {
    ...defaultProbe,
    ...probe,
  });
}

function runShellEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly userShell?: string;
  readonly probe: Partial<DesktopShellEnvironmentProbeShape>;
  readonly logger?: Logger.Logger<unknown, void>;
}) {
  const dependencyLayer = Layer.mergeAll(
    Layer.succeed(DesktopShellEnvironmentConfig, {
      env: input.env,
      platform: input.platform,
      userShell:
        input.userShell === undefined ? Option.none<string>() : Option.some(input.userShell),
    }),
    probeLayer(input.probe),
  );
  const shellEnvironmentLayer = DesktopShellEnvironmentLive.pipe(Layer.provide(dependencyLayer));
  const layer =
    input.logger === undefined
      ? shellEnvironmentLayer
      : Layer.mergeAll(
          shellEnvironmentLayer,
          Logger.layer([input.logger], { mergeWithExisting: false }),
        );

  return Effect.gen(function* () {
    const shellEnvironment = yield* DesktopShellEnvironment;
    yield* shellEnvironment.sync;
  }).pipe(Effect.provide(layer));
}

describe("DesktopShellEnvironment", () => {
  it.effect("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/Users/test/.local/bin:/usr/bin",
      };
      const calls: Array<{ readonly shell: string; readonly names: ReadonlyArray<string> }> = [];

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        probe: {
          readLoginShellEnvironment: (shell, names) =>
            Effect.sync(() => {
              calls.push({ shell, names });
              return {
                PATH: "/opt/homebrew/bin:/usr/bin",
                SSH_AUTH_SOCK: "/tmp/secretive.sock",
                HOMEBREW_PREFIX: "/opt/homebrew",
              };
            }),
        },
      });

      assert.deepEqual(calls, [{ shell: "/bin/zsh", names: LOGIN_SHELL_ENV_NAMES }]);
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/secretive.sock");
      assert.equal(env.HOMEBREW_PREFIX, "/opt/homebrew");
    }),
  );

  it.effect("preserves an inherited SSH_AUTH_SOCK value", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/inherited.sock",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        probe: {
          readLoginShellEnvironment: () =>
            Effect.succeed({
              PATH: "/opt/homebrew/bin:/usr/bin",
              SSH_AUTH_SOCK: "/tmp/login-shell.sock",
            }),
        },
      });

      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/inherited.sock");
    }),
  );

  it.effect("preserves inherited values when the login shell omits them", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/inherited.sock",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        probe: {
          readLoginShellEnvironment: () =>
            Effect.succeed({
              PATH: "/opt/homebrew/bin:/usr/bin",
            }),
        },
      });

      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/inherited.sock");
    }),
  );

  it.effect("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on linux", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };
      const calls: Array<{ readonly shell: string; readonly names: ReadonlyArray<string> }> = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        probe: {
          readLoginShellEnvironment: (shell, names) =>
            Effect.sync(() => {
              calls.push({ shell, names });
              return {
                PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin",
                SSH_AUTH_SOCK: "/tmp/secretive.sock",
              };
            }),
        },
      });

      assert.deepEqual(calls, [{ shell: "/bin/zsh", names: LOGIN_SHELL_ENV_NAMES }]);
      assert.equal(env.PATH, "/home/linuxbrew/.linuxbrew/bin:/usr/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/secretive.sock");
    }),
  );

  it.effect("falls back to launchctl PATH on macOS when shell probing does not return one", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/opt/homebrew/bin/nu",
        PATH: "/usr/bin",
      };
      const calls: Array<{ readonly shell: string; readonly names: ReadonlyArray<string> }> = [];
      let launchctlReadCount = 0;
      const messages: string[] = [];
      const logger = Logger.make(({ message }) => {
        messages.push(String(message));
      });

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        userShell: "/bin/zsh",
        logger,
        probe: {
          readLoginShellEnvironment: (shell, names) =>
            Effect.gen(function* () {
              calls.push({ shell, names });
              if (calls.length === 1) {
                return yield* Effect.fail(new Error("unknown flag"));
              }
              return {};
            }),
          readLaunchctlPath: Effect.sync(() => {
            launchctlReadCount += 1;
            return Option.some("/opt/homebrew/bin:/usr/bin");
          }),
        },
      });

      assert.deepEqual(calls, [
        { shell: "/opt/homebrew/bin/nu", names: LOGIN_SHELL_ENV_NAMES },
        { shell: "/bin/zsh", names: LOGIN_SHELL_ENV_NAMES },
      ]);
      assert.equal(launchctlReadCount, 1);
      assert.isTrue(
        messages.some((message) => message.includes("failed to read login shell environment")),
      );
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
    }),
  );

  it.effect("does nothing on unsupported platforms", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "C:/Program Files/Git/bin/bash.exe",
        PATH: "C:\\Windows\\System32",
        SSH_AUTH_SOCK: "/tmp/inherited.sock",
      };
      let readCount = 0;

      yield* runShellEnvironment({
        env,
        platform: "freebsd",
        probe: {
          readLoginShellEnvironment: () =>
            Effect.sync(() => {
              readCount += 1;
              return {
                PATH: "/usr/local/bin:/usr/bin",
                SSH_AUTH_SOCK: "/tmp/secretive.sock",
              };
            }),
        },
      });

      assert.equal(readCount, 0);
      assert.equal(env.PATH, "C:\\Windows\\System32");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/inherited.sock");
    }),
  );

  it.effect("hydrates PATH on Windows by merging PowerShell PATH with inherited PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
        USERPROFILE: "C:\\Users\\testuser",
      };
      const windowsReads: Array<{
        readonly names: ReadonlyArray<string>;
        readonly options: WindowsEnvironmentProbeOptions;
      }> = [];
      let commandAvailabilityChecks = 0;

      yield* runShellEnvironment({
        env,
        platform: "win32",
        probe: {
          readWindowsShellEnvironment: (names, options) =>
            Effect.sync(() => {
              windowsReads.push({ names, options });
              return { PATH: "C:\\Custom\\Bin;C:\\Windows\\System32" };
            }),
          isWindowsCommandAvailable: () =>
            Effect.sync(() => {
              commandAvailabilityChecks += 1;
              return true;
            }),
        },
      });

      assert.deepEqual(windowsReads, [{ names: ["PATH"], options: { loadProfile: false } }]);
      assert.equal(
        env.PATH,
        [
          "C:\\Users\\testuser\\AppData\\Roaming\\npm",
          "C:\\Users\\testuser\\AppData\\Local\\Programs\\nodejs",
          "C:\\Users\\testuser\\AppData\\Local\\Volta\\bin",
          "C:\\Users\\testuser\\AppData\\Local\\pnpm",
          "C:\\Users\\testuser\\.bun\\bin",
          "C:\\Users\\testuser\\scoop\\shims",
          "C:\\Custom\\Bin",
          "C:\\Windows\\System32",
        ].join(";"),
      );
      assert.equal(commandAvailabilityChecks, 1);
    }),
  );

  it.effect("loads the PowerShell profile on Windows when node is not available", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
        USERPROFILE: "C:\\Users\\testuser",
      };
      const windowsReads: Array<{
        readonly names: ReadonlyArray<string>;
        readonly options: WindowsEnvironmentProbeOptions;
      }> = [];

      yield* runShellEnvironment({
        env,
        platform: "win32",
        probe: {
          readWindowsShellEnvironment: (names, options) =>
            Effect.sync(() => {
              windowsReads.push({ names, options });
              return options.loadProfile
                ? {
                    PATH: "C:\\Profile\\Node;C:\\Windows\\System32",
                    FNM_DIR: "C:\\Users\\testuser\\AppData\\Roaming\\fnm",
                    FNM_MULTISHELL_PATH:
                      "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
                  }
                : { PATH: "C:\\Custom\\Bin;C:\\Windows\\System32" };
            }),
          isWindowsCommandAvailable: () => Effect.succeed(false),
        },
      });

      assert.equal(
        env.PATH,
        [
          "C:\\Profile\\Node",
          "C:\\Windows\\System32",
          "C:\\Users\\testuser\\AppData\\Roaming\\npm",
          "C:\\Users\\testuser\\AppData\\Local\\Programs\\nodejs",
          "C:\\Users\\testuser\\AppData\\Local\\Volta\\bin",
          "C:\\Users\\testuser\\AppData\\Local\\pnpm",
          "C:\\Users\\testuser\\.bun\\bin",
          "C:\\Users\\testuser\\scoop\\shims",
          "C:\\Custom\\Bin",
        ].join(";"),
      );
      assert.equal(env.FNM_DIR, "C:\\Users\\testuser\\AppData\\Roaming\\fnm");
      assert.equal(
        env.FNM_MULTISHELL_PATH,
        "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
      );
      assert.deepEqual(windowsReads, [
        { names: ["PATH"], options: { loadProfile: false } },
        { names: ["PATH", "FNM_DIR", "FNM_MULTISHELL_PATH"], options: { loadProfile: true } },
      ]);
    }),
  );

  it.effect("preserves baseline Windows env when the profile probe fails", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        USERPROFILE: "C:\\Users\\testuser",
      };

      yield* runShellEnvironment({
        env,
        platform: "win32",
        probe: {
          readWindowsShellEnvironment: (_names, options) =>
            Effect.gen(function* () {
              if (options.loadProfile) {
                return yield* Effect.fail(new Error("profile load failed"));
              }
              return { PATH: "C:\\Custom\\Bin;C:\\Windows\\System32" };
            }),
          isWindowsCommandAvailable: () => Effect.succeed(false),
        },
      });

      assert.equal(
        env.PATH,
        [
          "C:\\Users\\testuser\\AppData\\Roaming\\npm",
          "C:\\Users\\testuser\\.bun\\bin",
          "C:\\Users\\testuser\\scoop\\shims",
          "C:\\Custom\\Bin",
          "C:\\Windows\\System32",
        ].join(";"),
      );
      assert.isUndefined(env.SSH_AUTH_SOCK);
    }),
  );

  it.effect("live probe reads login shell variables through ChildProcessSpawner", () =>
    Effect.gen(function* () {
      let spawnedCommand: ChildProcess.Command | undefined;
      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            spawnedCommand = command;
            return makeProcess({
              stdout: Stream.make(
                textEncoder.encode(
                  [
                    "__T3CODE_ENV_PATH_START__",
                    "/opt/homebrew/bin:/usr/bin",
                    "__T3CODE_ENV_PATH_END__",
                    "__T3CODE_ENV_SSH_AUTH_SOCK_START__",
                    "/tmp/live.sock",
                    "__T3CODE_ENV_SSH_AUTH_SOCK_END__",
                  ].join("\n"),
                ),
              ),
            });
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const probe = yield* DesktopShellEnvironmentProbe;
        return yield* probe.readLoginShellEnvironment("/bin/zsh", ["PATH", "SSH_AUTH_SOCK"]);
      }).pipe(
        Effect.provide(
          DesktopShellEnvironmentProbeLive.pipe(
            Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer)),
          ),
        ),
        Effect.scoped,
      );

      assert.deepEqual(result, {
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/live.sock",
      });
      assert.isDefined(spawnedCommand);
      if (spawnedCommand?._tag === "StandardCommand") {
        assert.equal(spawnedCommand.command, "/bin/zsh");
        assert.equal(spawnedCommand.args[0], "-ilc");
        assert.include(spawnedCommand.args[1] ?? "", "__T3CODE_ENV_PATH_START__");
        assert.equal(spawnedCommand.options.stdout, "pipe");
        assert.equal(spawnedCommand.options.stderr, "pipe");
      }
    }),
  );
});
