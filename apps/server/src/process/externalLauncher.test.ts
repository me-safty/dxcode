import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import { ExternalLauncher, layer as ExternalLauncherLive } from "./externalLauncher.ts";

function makeMockDetachedHandle(onUnref: () => void = () => undefined) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const testLayer = (input: {
  readonly platform: NodeJS.Platform;
  readonly env?: Record<string, string>;
  readonly resolveExecutable?: (command: string) => string | undefined;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
}) => {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        return makeMockDetachedHandle(input.onUnref);
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncherLive.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer))),
    Layer.succeed(HostProcessPlatform, input.platform),
    Layer.succeed(
      SpawnExecutableResolution,
      (command) => input.resolveExecutable?.(command) ?? command,
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect("launches the default browser through the platform command", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher;

    yield* launcher.launchBrowser("https://example.com/some path");

    assert.ok(spawned);
    assert.equal(spawned.command, "xdg-open");
    assert.deepEqual(spawned.args, ["https://example.com/some path"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "linux",
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("launches an installed editor with platform-safe arguments", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "vscode",
        cwd: "C:\\workspace with spaces\\src\\index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
          resolveExecutable: (command) =>
            command === "code" ? "C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD" : command,
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, '^"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.CMD^"');
    assert.deepEqual(spawned.args, [
      '^"--goto^"',
      '^"C:\\workspace^ with^ spaces\\src\\index.ts:12:4^"',
    ]);
    assert.equal(spawned.options.shell, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers editors through the service API", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");
    yield* fileSystem.writeFileString(path.join(binDir, "explorer.CMD"), "@echo off\r\n");

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        }),
      ),
    );

    assert.equal(editors.includes("vscode"), true);
    assert.equal(editors.includes("file-manager"), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects unknown editors through the service API", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher;
    const result = yield* launcher
      .launchEditor({ editor: "missing-editor" as never, cwd: "/tmp/workspace" })
      .pipe(Effect.result);
    assert.equal(result._tag, "Failure");
  }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: "" } }))),
);

const emptyExternal = { osxExec: "", linuxExec: "", windowsExec: "" } as const;

it.effect("opens the configured macOS terminal at the workspace path", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher;
    yield* launcher.launchTerminal({
      cwd: "/Users/me/workspace",
      external: { ...emptyExternal, osxExec: "Ghostty" },
    });

    assert.ok(spawned);
    assert.equal(spawned.command, "open");
    assert.deepEqual(spawned.args, ["-a", "Ghostty", "/Users/me/workspace"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "darwin",
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("prefers an explicit exec override over the configured terminal", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher;
    yield* launcher.launchTerminal({
      cwd: "/Users/me/workspace",
      external: { ...emptyExternal, osxExec: "Ghostty" },
      exec: "iTerm",
    });

    assert.ok(spawned);
    assert.deepEqual(spawned.args, ["-a", "iTerm", "/Users/me/workspace"]);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "darwin",
        onSpawn: (command) => {
          spawned = command;
        },
      }),
    ),
  );
});

it.effect("writes a run script and opens it on macOS when given a command", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    let spawned: ChildProcess.StandardCommand | undefined;

    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      yield* launcher.launchTerminal({
        cwd: "/Users/me/work space",
        external: { ...emptyExternal, osxExec: "Ghostty" },
        command: "npm run dev",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, "open");
    assert.equal(spawned.args[0], "-a");
    assert.equal(spawned.args[1], "Ghostty");
    const scriptPath = spawned.args[2];
    assert.ok(scriptPath?.endsWith(".command"));
    const contents = yield* fileSystem.readFileString(scriptPath ?? "");
    assert.equal(contents.includes("cd '/Users/me/work space'"), true);
    assert.equal(contents.includes("npm run dev"), true);
    assert.equal(contents.includes(`exec "${"${SHELL:-/bin/sh}"}" -il`), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs a command through a run script on Linux terminals", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-terminals-" });
    yield* fileSystem.writeFileString(path.join(binDir, "alacritty"), "#!/bin/sh\n");
    yield* fileSystem.chmod(path.join(binDir, "alacritty"), 0o755);

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      yield* launcher.launchTerminal({
        cwd: "/home/me/workspace",
        external: { ...emptyExternal, linuxExec: "alacritty" },
        command: "make build",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "linux",
          env: { PATH: binDir },
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, "alacritty");
    assert.equal(spawned.args[0], "-e");
    assert.ok(spawned.args[1]?.endsWith(".sh"));
    const contents = yield* fileSystem.readFileString(spawned.args[1] ?? "");
    assert.equal(contents.includes("make build"), true);
    assert.equal(spawned.options.cwd, "/home/me/workspace");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("opens Windows Terminal with the run script in the working directory", () =>
  Effect.gen(function* () {
    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      yield* launcher.launchTerminal({
        cwd: "C:\\workspace",
        external: { ...emptyExternal, windowsExec: "wt.exe" },
        command: "npm test",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, "wt.exe");
    assert.equal(spawned.args[0], "-d");
    assert.equal(spawned.args[1], "C:\\workspace");
    assert.equal(spawned.args[2], "cmd.exe");
    assert.equal(spawned.args[3], "/k");
    assert.ok(spawned.args[4]?.endsWith(".cmd"));
    assert.equal(spawned.options.cwd, "C:\\workspace");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("falls back to cmd.exe start for non-Windows-Terminal executables", () =>
  Effect.gen(function* () {
    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      yield* launcher.launchTerminal({
        cwd: "C:\\workspace",
        external: { ...emptyExternal, windowsExec: "pwsh.exe" },
        command: "npm test",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, "cmd.exe");
    assert.equal(spawned.args[0], "/c");
    assert.equal(spawned.args[1], "start");
    assert.equal(spawned.args[2], "");
    assert.equal(spawned.args[3], "cmd.exe");
    assert.equal(spawned.args[4], "/k");
    assert.ok(spawned.args[5]?.endsWith(".cmd"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("fails when no terminal command is available on Linux", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher;
    const result = yield* launcher
      .launchTerminal({
        cwd: "/home/me/workspace",
        external: { ...emptyExternal, linuxExec: "definitely-missing-term" },
      })
      .pipe(Effect.result);
    assert.equal(result._tag, "Failure");
  }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: "" } }))),
);

it.effect("discovers installed Linux terminals through the service API", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-terminals-" });
    yield* fileSystem.writeFileString(path.join(binDir, "xterm"), "#!/bin/sh\n");
    yield* fileSystem.chmod(path.join(binDir, "xterm"), 0o755);
    yield* fileSystem.writeFileString(path.join(binDir, "kitty"), "#!/bin/sh\n");
    yield* fileSystem.chmod(path.join(binDir, "kitty"), 0o755);

    const terminals = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher;
      return yield* launcher.resolveAvailableTerminals();
    }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: binDir } })));

    assert.equal(terminals.includes("xterm"), true);
    assert.equal(terminals.includes("kitty"), true);
    assert.equal(terminals.includes("gnome-terminal"), false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
