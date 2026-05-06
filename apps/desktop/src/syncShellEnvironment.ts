import {
  Context,
  Data,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DesktopEnvironment } from "./desktopEnvironment.ts";

type EnvironmentPatch = Partial<Record<string, string>>;

export interface WindowsEnvironmentProbeOptions {
  readonly loadProfile?: boolean;
}

export interface CommandAvailabilityOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

const LOGIN_SHELL_ENV_NAMES = [
  "PATH",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;
const SHELL_ENV_NAME_PATTERN = /^[A-Z0-9_]+$/;
const WINDOWS_PATH_DELIMITER = ";";
const POSIX_PATH_DELIMITER = ":";
const WINDOWS_SHELL_CANDIDATES = ["pwsh.exe", "powershell.exe"] as const;
const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
const LAUNCHCTL_TIMEOUT = Duration.seconds(2);
const PROCESS_TERMINATE_GRACE = Duration.seconds(1);

export class DesktopShellEnvironmentCommandError extends Data.TaggedError(
  "DesktopShellEnvironmentCommandError",
)<{
  readonly command: readonly string[];
  readonly message: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export interface DesktopShellEnvironmentConfigShape {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly userShell: Option.Option<string>;
}

export class DesktopShellEnvironmentConfig extends Context.Service<
  DesktopShellEnvironmentConfig,
  DesktopShellEnvironmentConfigShape
>()("t3/desktop/ShellEnvironmentConfig") {}

export interface DesktopShellEnvironmentProbeShape {
  readonly readLoginShellEnvironment: (
    shell: string,
    names: ReadonlyArray<string>,
  ) => Effect.Effect<EnvironmentPatch, unknown>;
  readonly readLaunchctlPath: Effect.Effect<Option.Option<string>, unknown>;
  readonly readWindowsShellEnvironment: (
    names: ReadonlyArray<string>,
    options: WindowsEnvironmentProbeOptions,
  ) => Effect.Effect<EnvironmentPatch, unknown>;
  readonly isWindowsCommandAvailable: (
    command: string,
    options: CommandAvailabilityOptions,
  ) => Effect.Effect<boolean, unknown>;
}

export class DesktopShellEnvironmentProbe extends Context.Service<
  DesktopShellEnvironmentProbe,
  DesktopShellEnvironmentProbeShape
>()("t3/desktop/ShellEnvironmentProbe") {}

export interface DesktopShellEnvironmentShape {
  readonly sync: Effect.Effect<void>;
}

export class DesktopShellEnvironment extends Context.Service<
  DesktopShellEnvironment,
  DesktopShellEnvironmentShape
>()("t3/desktop/ShellEnvironment") {}

const trimNonEmptyOption = (value: string | null | undefined): Option.Option<string> => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

function listLoginShellCandidates(input: {
  readonly platform: NodeJS.Platform;
  readonly shell: string | undefined;
  readonly userShell: Option.Option<string>;
}): ReadonlyArray<string> {
  const fallbackShell =
    input.platform === "darwin" ? "/bin/zsh" : input.platform === "linux" ? "/bin/bash" : "";
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const candidate of [
    trimNonEmptyOption(input.shell),
    input.userShell,
    trimNonEmptyOption(fallbackShell),
  ]) {
    if (Option.isNone(candidate) || seen.has(candidate.value)) {
      continue;
    }
    seen.add(candidate.value);
    candidates.push(candidate.value);
  }

  return candidates;
}

function pathDelimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? WINDOWS_PATH_DELIMITER : POSIX_PATH_DELIMITER;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function normalizePathEntryForComparison(entry: string, platform: NodeJS.Platform): string {
  const normalized = stripWrappingQuotes(entry.trim());
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function mergePathValues(
  preferredPath: Option.Option<string>,
  inheritedPath: Option.Option<string>,
  platform: NodeJS.Platform,
): Option.Option<string> {
  const delimiter = pathDelimiterForPlatform(platform);
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of [preferredPath, inheritedPath]) {
    if (Option.isNone(rawValue)) continue;

    for (const entry of rawValue.value.split(delimiter)) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;

      const normalized = normalizePathEntryForComparison(trimmed, platform);
      if (normalized.length === 0 || seen.has(normalized)) continue;

      seen.add(normalized);
      merged.push(trimmed);
    }
  }

  return merged.length > 0 ? Option.some(merged.join(delimiter)) : Option.none();
}

function readEnvPath(env: NodeJS.ProcessEnv): Option.Option<string> {
  return trimNonEmptyOption(env.PATH ?? env.Path ?? env.path);
}

function resolveKnownWindowsCliDirs(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const appData = env.APPDATA?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();

  return [
    ...(appData ? [`${appData}\\npm`] : []),
    ...(localAppData ? [`${localAppData}\\Programs\\nodejs`, `${localAppData}\\Volta\\bin`] : []),
    ...(localAppData ? [`${localAppData}\\pnpm`] : []),
    ...(userProfile ? [`${userProfile}\\.bun\\bin`, `${userProfile}\\scoop\\shims`] : []),
  ];
}

function mergeWindowsEnv(
  currentEnv: NodeJS.ProcessEnv,
  patch: Partial<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...currentEnv };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

function envCaptureStart(name: string): string {
  return `__T3CODE_ENV_${name}_START__`;
}

function envCaptureEnd(name: string): string {
  return `__T3CODE_ENV_${name}_END__`;
}

function buildEnvironmentCaptureCommand(names: ReadonlyArray<string>): string {
  return names
    .map((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }

      return [
        `printf '%s\\n' '${envCaptureStart(name)}'`,
        `printenv ${name} || true`,
        `printf '%s\\n' '${envCaptureEnd(name)}'`,
      ].join("; ");
    })
    .join("; ");
}

function buildWindowsEnvironmentCaptureCommand(names: ReadonlyArray<string>): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    ...names.flatMap((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }

      return [
        `Write-Output '${envCaptureStart(name)}'`,
        `$value = [Environment]::GetEnvironmentVariable('${name}')`,
        "if ($null -ne $value -and $value.Length -gt 0) { Write-Output $value }",
        `Write-Output '${envCaptureEnd(name)}'`,
      ];
    }),
  ].join("; ");
}

function extractEnvironmentValue(output: string, name: string): Option.Option<string> {
  const startMarker = envCaptureStart(name);
  const endMarker = envCaptureEnd(name);
  const startIndex = output.indexOf(startMarker);
  if (startIndex === -1) return Option.none();

  const valueStartIndex = startIndex + startMarker.length;
  const endIndex = output.indexOf(endMarker, valueStartIndex);
  if (endIndex === -1) return Option.none();

  const value = output
    .slice(valueStartIndex, endIndex)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");

  return value.length > 0 ? Option.some(value) : Option.none();
}

function extractEnvironment(output: string, names: ReadonlyArray<string>): EnvironmentPatch {
  const environment: EnvironmentPatch = {};
  for (const name of names) {
    const value = extractEnvironmentValue(output, name);
    if (Option.isSome(value)) {
      environment[name] = value.value;
    }
  }
  return environment;
}

const collectProcessOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

function commandError(input: {
  readonly command: readonly string[];
  readonly message: string;
  readonly exitCode: number | null;
  readonly stderr?: string;
}): DesktopShellEnvironmentCommandError {
  return new DesktopShellEnvironmentCommandError({
    command: input.command,
    message: input.message,
    exitCode: input.exitCode,
    stderr: input.stderr ?? "",
  });
}

const runCommandOnce = Effect.fn("desktop.shellEnvironment.runCommandOnce")(function* (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell?: boolean;
}): Effect.fn.Return<
  string,
  DesktopShellEnvironmentCommandError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const command = [input.command, ...input.args];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner
    .spawn(
      ChildProcess.make(input.command, input.args, {
        shell: input.shell ?? false,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        killSignal: "SIGTERM",
        forceKillAfter: PROCESS_TERMINATE_GRACE,
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        commandError({
          command,
          message: cause instanceof Error ? cause.message : "Failed to spawn shell probe.",
          exitCode: null,
        }),
      ),
    );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectProcessOutput(child.stdout),
      collectProcessOutput(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError((cause) =>
      commandError({
        command,
        message: cause instanceof Error ? cause.message : "Failed to run shell probe.",
        exitCode: null,
      }),
    ),
  );

  if (exitCode !== 0) {
    return yield* commandError({
      command,
      message: `Shell probe exited with code ${exitCode}.`,
      exitCode,
      stderr,
    });
  }

  return stdout;
});

const runCommand = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell?: boolean;
  readonly timeout: Duration.Duration;
}): Effect.Effect<
  string,
  DesktopShellEnvironmentCommandError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  runCommandOnce(input).pipe(
    Effect.timeoutOption(input.timeout),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            commandError({
              command: [input.command, ...input.args],
              message: `Shell probe timed out after ${Duration.format(input.timeout)}.`,
              exitCode: null,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

const readLoginShellEnvironmentEffect = (
  shell: string,
  names: ReadonlyArray<string>,
): Effect.Effect<
  EnvironmentPatch,
  DesktopShellEnvironmentCommandError,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  if (names.length === 0) {
    return Effect.succeed({});
  }

  return runCommand({
    command: shell,
    args: ["-ilc", buildEnvironmentCaptureCommand(names)],
    timeout: LOGIN_SHELL_TIMEOUT,
  }).pipe(
    Effect.map((output) => extractEnvironment(output, names)),
    Effect.scoped,
  );
};

const readLaunchctlPathEffect: Effect.Effect<
  Option.Option<string>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = runCommand({
  command: "/bin/launchctl",
  args: ["getenv", "PATH"],
  timeout: LAUNCHCTL_TIMEOUT,
}).pipe(
  Effect.map((output) => trimNonEmptyOption(output)),
  Effect.catch(() => Effect.succeed(Option.none())),
  Effect.scoped,
);

const readWindowsShellEnvironmentEffect = (
  names: ReadonlyArray<string>,
  options: WindowsEnvironmentProbeOptions,
): Effect.Effect<EnvironmentPatch, never, ChildProcessSpawner.ChildProcessSpawner> => {
  if (names.length === 0) {
    return Effect.succeed({});
  }

  const command = buildWindowsEnvironmentCaptureCommand(names);
  const args = [
    "-NoLogo",
    ...(options.loadProfile ? ([] as const) : (["-NoProfile"] as const)),
    "-NonInteractive",
    "-Command",
    command,
  ];

  return Effect.gen(function* () {
    for (const shell of WINDOWS_SHELL_CANDIDATES) {
      const output = yield* runCommand({
        command: shell,
        args,
        shell: true,
        timeout: LOGIN_SHELL_TIMEOUT,
      }).pipe(Effect.option, Effect.scoped);
      if (Option.isSome(output)) {
        return extractEnvironment(output.value, names);
      }
    }

    return {};
  });
};

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) return fallback;

  const parsed = rawValue
    .split(WINDOWS_PATH_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function resolveCommandCandidates(input: {
  readonly command: string;
  readonly platform: NodeJS.Platform;
  readonly windowsPathExtensions: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  if (input.platform !== "win32") return [input.command];
  const extension = input.command.slice(input.command.lastIndexOf(".")).toUpperCase();

  if (input.command.includes(".") && input.windowsPathExtensions.includes(extension)) {
    const commandWithoutExtension = input.command.slice(0, -extension.length);
    return Array.from(
      new Set([
        input.command,
        `${commandWithoutExtension}${extension}`,
        `${commandWithoutExtension}${extension.toLowerCase()}`,
      ]),
    );
  }

  const candidates: string[] = [];
  for (const candidateExtension of input.windowsPathExtensions) {
    candidates.push(`${input.command}${candidateExtension}`);
    candidates.push(`${input.command}${candidateExtension.toLowerCase()}`);
  }
  return Array.from(new Set(candidates));
}

function isPathCommand(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

const isExecutableFile = Effect.fn("desktop.shellEnvironment.isExecutableFile")(function* (
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stat = yield* fileSystem.stat(filePath).pipe(Effect.option);
  if (Option.isNone(stat) || stat.value.type !== "File") {
    return false;
  }

  if (platform !== "win32") {
    return yield* fileSystem.access(filePath, { ok: true }).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  const extension = path.extname(filePath).toUpperCase();
  return extension.length > 0 && windowsPathExtensions.includes(extension);
});

const resolveCommandPathEffect = Effect.fn("desktop.shellEnvironment.resolveCommandPath")(
  function* (
    command: string,
    options: CommandAvailabilityOptions,
  ): Effect.fn.Return<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
    const path = yield* Path.Path;
    const windowsPathExtensions =
      options.platform === "win32" ? resolveWindowsPathExtensions(options.env) : [];
    const commandCandidates = resolveCommandCandidates({
      command,
      platform: options.platform,
      windowsPathExtensions,
    });

    if (isPathCommand(command)) {
      for (const candidate of commandCandidates) {
        if (yield* isExecutableFile(candidate, options.platform, windowsPathExtensions)) {
          return Option.some(candidate);
        }
      }
      return Option.none();
    }

    const pathValue = readEnvPath(options.env);
    if (Option.isNone(pathValue)) return Option.none();

    const pathEntries = pathValue.value
      .split(pathDelimiterForPlatform(options.platform))
      .map((entry) => stripWrappingQuotes(entry.trim()))
      .filter((entry) => entry.length > 0);

    for (const pathEntry of pathEntries) {
      for (const candidate of commandCandidates) {
        const candidatePath = path.join(pathEntry, candidate);
        if (yield* isExecutableFile(candidatePath, options.platform, windowsPathExtensions)) {
          return Option.some(candidatePath);
        }
      }
    }

    return Option.none();
  },
);

const isWindowsCommandAvailableEffect = (
  command: string,
  options: CommandAvailabilityOptions,
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  resolveCommandPathEffect(command, options).pipe(Effect.map(Option.isSome));

export const DesktopShellEnvironmentProbeLive = Layer.effect(
  DesktopShellEnvironmentProbe,
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return {
      readLoginShellEnvironment: (shell, names) =>
        readLoginShellEnvironmentEffect(shell, names).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
        ),
      readLaunchctlPath: readLaunchctlPathEffect.pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      ),
      readWindowsShellEnvironment: (names, options) =>
        readWindowsShellEnvironmentEffect(names, options).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
        ),
      isWindowsCommandAvailable: (command, options) =>
        isWindowsCommandAvailableEffect(command, options).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
    } satisfies DesktopShellEnvironmentProbeShape;
  }),
);

export const DesktopShellEnvironmentConfigLive = Layer.effect(
  DesktopShellEnvironmentConfig,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    return {
      env: process.env,
      platform: environment.platform,
      userShell: Option.none(),
    } satisfies DesktopShellEnvironmentConfigShape;
  }),
);

const applyEnvironmentPatch = (env: NodeJS.ProcessEnv, patch: EnvironmentPatch): void => {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
};

const readWindowsEnvironmentSafely = (
  probe: DesktopShellEnvironmentProbeShape,
  names: ReadonlyArray<string>,
  options: WindowsEnvironmentProbeOptions,
): Effect.Effect<EnvironmentPatch> =>
  probe.readWindowsShellEnvironment(names, options).pipe(Effect.catch(() => Effect.succeed({})));

const resolveWindowsEnvironmentEffect = Effect.fn(
  "desktop.shellEnvironment.resolveWindowsEnvironment",
)(function* (
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<Partial<NodeJS.ProcessEnv>, never, DesktopShellEnvironmentProbe> {
  const probe = yield* DesktopShellEnvironmentProbe;
  const shellPath = yield* readWindowsEnvironmentSafely(probe, ["PATH"], {
    loadProfile: false,
  }).pipe(Effect.map((environment) => trimNonEmptyOption(environment.PATH)));
  const mergedPath = mergePathValues(shellPath, readEnvPath(env), "win32");
  const knownCliPath = trimNonEmptyOption(
    resolveKnownWindowsCliDirs(env).join(WINDOWS_PATH_DELIMITER),
  );
  const baselinePath = mergePathValues(knownCliPath, mergedPath, "win32");
  const baselinePatch: Partial<NodeJS.ProcessEnv> = Option.match(baselinePath, {
    onNone: () => ({}),
    onSome: (value) => ({ PATH: value }),
  });
  const baselineEnv = mergeWindowsEnv(env, baselinePatch);

  const nodeAvailable = yield* probe
    .isWindowsCommandAvailable("node", { platform: "win32", env: baselineEnv })
    .pipe(Effect.catch(() => Effect.succeed(false)));
  if (nodeAvailable) {
    return baselinePatch;
  }

  const profiledEnvironment = yield* readWindowsEnvironmentSafely(
    probe,
    ["PATH", "FNM_DIR", "FNM_MULTISHELL_PATH"],
    { loadProfile: true },
  );
  const profiledPath = mergePathValues(
    trimNonEmptyOption(profiledEnvironment.PATH),
    baselinePath,
    "win32",
  );
  const profiledPatch: Partial<NodeJS.ProcessEnv> = {
    ...Option.match(profiledPath, {
      onNone: () => ({}),
      onSome: (value) => ({ PATH: value }),
    }),
    ...(profiledEnvironment.FNM_DIR ? { FNM_DIR: profiledEnvironment.FNM_DIR } : {}),
    ...(profiledEnvironment.FNM_MULTISHELL_PATH
      ? { FNM_MULTISHELL_PATH: profiledEnvironment.FNM_MULTISHELL_PATH }
      : {}),
  };

  return Object.keys(profiledPatch).length > 0
    ? { ...baselinePatch, ...profiledPatch }
    : baselinePatch;
});

const syncPosixShellEnvironment = Effect.fn("desktop.shellEnvironment.syncPosix")(function* (
  config: DesktopShellEnvironmentConfigShape,
): Effect.fn.Return<void, never, DesktopShellEnvironmentProbe> {
  const probe = yield* DesktopShellEnvironmentProbe;
  const shellEnvironment: EnvironmentPatch = {};

  for (const shell of listLoginShellCandidates({
    platform: config.platform,
    shell: config.env.SHELL,
    userShell: config.userShell,
  })) {
    const result = yield* probe.readLoginShellEnvironment(shell, LOGIN_SHELL_ENV_NAMES).pipe(
      Effect.option,
      Effect.tap((environment) =>
        Option.isNone(environment)
          ? Effect.logWarning("failed to read login shell environment", { shell })
          : Effect.void,
      ),
    );

    if (Option.isSome(result)) {
      Object.assign(shellEnvironment, result.value);
      if (shellEnvironment.PATH) {
        break;
      }
    }
  }

  const launchctlPath =
    config.platform === "darwin" && !shellEnvironment.PATH
      ? yield* probe.readLaunchctlPath.pipe(
          Effect.catch(() => Effect.succeed(Option.none<string>())),
        )
      : Option.none<string>();
  const mergedPath = mergePathValues(
    trimNonEmptyOption(shellEnvironment.PATH).pipe(Option.orElse(() => launchctlPath)),
    readEnvPath(config.env),
    config.platform,
  );
  if (Option.isSome(mergedPath)) {
    config.env.PATH = mergedPath.value;
  }

  if (!config.env.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
    config.env.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
  }

  for (const name of [
    "HOMEBREW_PREFIX",
    "HOMEBREW_CELLAR",
    "HOMEBREW_REPOSITORY",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ] as const) {
    if (!config.env[name] && shellEnvironment[name]) {
      config.env[name] = shellEnvironment[name];
    }
  }
});

export const syncShellEnvironmentEffect: Effect.Effect<
  void,
  never,
  DesktopShellEnvironmentConfig | DesktopShellEnvironmentProbe
> = Effect.gen(function* () {
  const config = yield* DesktopShellEnvironmentConfig;

  yield* Effect.gen(function* () {
    if (config.platform === "win32") {
      applyEnvironmentPatch(config.env, yield* resolveWindowsEnvironmentEffect(config.env));
      return;
    }

    if (config.platform !== "darwin" && config.platform !== "linux") {
      return;
    }

    yield* syncPosixShellEnvironment(config);
  });
});

export const DesktopShellEnvironmentLive = Layer.effect(
  DesktopShellEnvironment,
  Effect.gen(function* () {
    const config = yield* DesktopShellEnvironmentConfig;
    const probe = yield* DesktopShellEnvironmentProbe;
    return {
      sync: syncShellEnvironmentEffect.pipe(
        Effect.provideService(DesktopShellEnvironmentConfig, config),
        Effect.provideService(DesktopShellEnvironmentProbe, probe),
      ),
    } satisfies DesktopShellEnvironmentShape;
  }),
);
