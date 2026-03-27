/**
 * ServiceHealth - External service auth status checks.
 *
 * Checks whether CLI tools (gogcli, gcalcli) and credentials (~/.netrc)
 * are available and authenticated.
 *
 * @module ServiceHealth
 */
import * as OS from "node:os";
import type { ServiceAuthStatus } from "@t3tools/contracts";
import { Effect, FileSystem, Option, Path, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const DEFAULT_TIMEOUT_MS = 4_000;

// ── Pure helpers ────────────────────────────────────────────────────

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

const runCommand = (bin: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(bin, [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return lower.includes("enoent") || lower.includes("notfound");
}

// ── Gmail check ─────────────────────────────────────────────────────

/**
 * Check Gmail auth by running `gogcli gmail search "is:unread" --account tryan@mediafly.com --json --max 1`.
 * If it succeeds, authenticated. If it errors about keyring/auth, unauthenticated.
 * If command not found, not available.
 */
export const checkGmailStatus: Effect.Effect<
  ServiceAuthStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();

  const probe = yield* runCommand("gogcli", [
    "gmail", "search", "is:unread",
    "--account", "tryan@mediafly.com",
    "--json", "--max", "1",
  ]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(probe)) {
    const error = probe.failure;
    return {
      service: "gmail" as const,
      available: false,
      authenticated: false,
      checkedAt,
      message: isCommandMissingCause(error)
        ? "gogcli is not installed or not on PATH."
        : `Failed to check Gmail status: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(probe.success)) {
    return {
      service: "gmail" as const,
      available: false,
      authenticated: false,
      checkedAt,
      message: "gogcli check timed out.",
    };
  }

  const res = probe.success.value;

  if (res.code === 0) {
    return { service: "gmail" as const, available: true, authenticated: true, checkedAt };
  }

  const output = `${res.stdout}\n${res.stderr}`.toLowerCase();
  if (
    output.includes("keyring") ||
    output.includes("password") ||
    output.includes("decrypt") ||
    output.includes("auth")
  ) {
    return {
      service: "gmail" as const,
      available: true,
      authenticated: false,
      checkedAt,
      message: "gogcli keyring password not set. Set GOG_KEYRING_PASSWORD env var.",
    };
  }

  return {
    service: "gmail" as const,
    available: true,
    authenticated: false,
    checkedAt,
    message: res.stderr.trim() || `gogcli exited with code ${res.code}.`,
  };
}).pipe(
  Effect.catch(() =>
    Effect.succeed({
      service: "gmail" as const,
      available: false,
      authenticated: false,
      checkedAt: new Date().toISOString(),
      message: "Failed to check Gmail status.",
    }),
  ),
);

// ── Jira check ──────────────────────────────────────────────────────

/**
 * Check Jira auth by looking for ~/.netrc entry for mediafly.atlassian.net.
 */
export const checkJiraStatus: Effect.Effect<
  ServiceAuthStatus,
  never,
  FileSystem.FileSystem | Path.Path
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const netrcPath = path.join(OS.homedir(), ".netrc");

  const content = yield* fileSystem
    .readFileString(netrcPath)
    .pipe(Effect.orElseSucceed(() => undefined));

  if (!content) {
    return {
      service: "jira" as const,
      available: false,
      authenticated: false,
      checkedAt,
      message: "~/.netrc not found. Create it with your Jira API token.",
    };
  }

  if (content.includes("mediafly.atlassian.net")) {
    return { service: "jira" as const, available: true, authenticated: true, checkedAt };
  }

  return {
    service: "jira" as const,
    available: true,
    authenticated: false,
    checkedAt,
    message: "~/.netrc exists but missing mediafly.atlassian.net entry.",
  };
}).pipe(
  Effect.catch(() =>
    Effect.succeed({
      service: "jira" as const,
      available: false,
      authenticated: false,
      checkedAt: new Date().toISOString(),
      message: "Failed to check Jira status.",
    }),
  ),
);

// ── Calendar check ──────────────────────────────────────────────────

/**
 * Check Calendar auth by running `gcalcli agenda --tsv --nocolor`.
 */
export const checkCalendarStatus: Effect.Effect<
  ServiceAuthStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();

  const probe = yield* runCommand("gcalcli", ["agenda", "--tsv", "--nocolor"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(probe)) {
    const error = probe.failure;
    return {
      service: "calendar" as const,
      available: false,
      authenticated: false,
      checkedAt,
      message: isCommandMissingCause(error)
        ? "gcalcli is not installed or not on PATH."
        : `Failed to check Calendar status: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(probe.success)) {
    return {
      service: "calendar" as const,
      available: false,
      authenticated: false,
      checkedAt,
      message: "gcalcli check timed out.",
    };
  }

  const res = probe.success.value;

  if (res.code === 0) {
    return { service: "calendar" as const, available: true, authenticated: true, checkedAt };
  }

  const output = `${res.stdout}\n${res.stderr}`.toLowerCase();
  if (
    output.includes("auth") ||
    output.includes("credentials") ||
    output.includes("token") ||
    output.includes("login")
  ) {
    return {
      service: "calendar" as const,
      available: true,
      authenticated: false,
      checkedAt,
      message: "gcalcli needs authentication. Run `gcalcli init`.",
    };
  }

  return {
    service: "calendar" as const,
    available: true,
    authenticated: false,
    checkedAt,
    message: res.stderr.trim() || `gcalcli exited with code ${res.code}.`,
  };
}).pipe(
  Effect.catch(() =>
    Effect.succeed({
      service: "calendar" as const,
      available: false,
      authenticated: false,
      checkedAt: new Date().toISOString(),
      message: "Failed to check Calendar status.",
    }),
  ),
);

// ── Aggregate ───────────────────────────────────────────────────────

/**
 * Run all service checks concurrently.
 */
export const checkAllServiceStatuses: Effect.Effect<
  ReadonlyArray<ServiceAuthStatus>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.all(
  [checkGmailStatus, checkJiraStatus, checkCalendarStatus],
  { concurrency: "unbounded" },
);
