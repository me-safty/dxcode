import {
  type CodeRabbitCancelReviewInput,
  type CodeRabbitGetStatusInput,
  CodeRabbitReviewId,
  type CodeRabbitReviewId as CodeRabbitReviewIdType,
  CodeRabbitRpcError,
  type CodeRabbitReviewEvent,
  type CodeRabbitReviewSnapshot,
  type CodeRabbitReviewStatus,
  type CodeRabbitStartReviewInput,
  type CodeRabbitStartReviewResult,
  type CodeRabbitFinding,
  type CodeRabbitGetReviewInput,
} from "@t3tools/contracts";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Effect, Layer, PubSub, Stream } from "effect";

import { runProcess } from "../../processRunner";
import { parseCodeRabbitAuthStatusOutput, parseCodeRabbitCliLine } from "../parser";
import { CodeRabbitService, type CodeRabbitServiceShape } from "../Services/CodeRabbitService";

type CliStatus = {
  readonly available: boolean;
  readonly authenticated: boolean;
};

type CliStatusCacheEntry = {
  readonly checkedAtMs: number;
  readonly value: CliStatus;
};

type ReviewTerminalEvent = Extract<
  CodeRabbitReviewEvent,
  { type: "completed" | "errored" | "cancelled" }
>;

type CodeRabbitSpawnExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

export interface CodeRabbitSpawnedReviewProcess {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly onExit: Promise<CodeRabbitSpawnExit>;
  readonly kill: () => void;
}

export interface CodeRabbitServiceOptions {
  readonly now?: () => string;
  readonly runCommand?: typeof runProcess;
  readonly reviewIdFactory?: () => CodeRabbitReviewIdType;
  readonly spawnReviewProcess?: (
    input: CodeRabbitStartReviewInput,
  ) => Effect.Effect<CodeRabbitSpawnedReviewProcess, CodeRabbitRpcError>;
}

interface ReviewRecord {
  readonly reviewId: CodeRabbitReviewIdType;
  snapshot: CodeRabbitReviewSnapshot;
  readonly pubsub: PubSub.PubSub<CodeRabbitReviewEvent>;
  process: CodeRabbitSpawnedReviewProcess | null;
  lastTerminalEvent: ReviewTerminalEvent | null;
  readonly stderrLines: string[];
  readonly stdoutLines: string[];
}

const CLI_STATUS_CACHE_TTL_MS = 10_000;
const REVIEW_PROCESS_STDIO_BUFFER_LINES = 20;

function isTerminalPhase(phase: CodeRabbitReviewSnapshot["phase"]) {
  return phase === "completed" || phase === "errored" || phase === "cancelled";
}

function cloneFinding(finding: CodeRabbitFinding): CodeRabbitFinding {
  return {
    ...finding,
    location:
      finding.location.type === "file"
        ? { ...finding.location }
        : {
            ...finding.location,
            ...(finding.location.lineRange ? { lineRange: { ...finding.location.lineRange } } : {}),
          },
    suggestions: [...finding.suggestions],
  };
}

function cloneSnapshot(snapshot: CodeRabbitReviewSnapshot): CodeRabbitReviewSnapshot {
  return {
    ...snapshot,
    findings: snapshot.findings.map(cloneFinding),
  };
}

function pushBufferedLine(buffer: string[], line: string) {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return;
  }
  buffer.push(normalized);
  if (buffer.length > REVIEW_PROCESS_STDIO_BUFFER_LINES) {
    buffer.splice(0, buffer.length - REVIEW_PROCESS_STDIO_BUFFER_LINES);
  }
}

function formatExitFailureMessage(record: ReviewRecord, exit: CodeRabbitSpawnExit) {
  const stderr = record.stderrLines.join("\n").trim();
  if (stderr.length > 0) {
    return stderr;
  }
  const stdout = record.stdoutLines.join("\n").trim();
  if (stdout.length > 0) {
    return stdout;
  }
  return `CodeRabbit review process exited with code=${exit.code ?? "null"} signal=${exit.signal ?? "null"}.`;
}

function killChildProcessTree(child: ChildProcess): void {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fall through to direct kill
    }
  }
  child.kill("SIGTERM");
}

function defaultSpawnReviewProcess(
  input: CodeRabbitStartReviewInput,
): Effect.Effect<CodeRabbitSpawnedReviewProcess, CodeRabbitRpcError> {
  return Effect.try({
    try: () => {
      const args = [
        "review",
        "--agent",
        "--type",
        input.scope,
        "--cwd",
        input.cwd,
        "--no-color",
        ...(input.baseBranch ? ["--base", input.baseBranch] : []),
      ];
      const child = spawn("coderabbit", args, {
        cwd: input.cwd,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const onExit = new Promise<CodeRabbitSpawnExit>((resolve, reject) => {
        child.once("error", (error) => reject(error));
        child.once("close", (code, signal) => resolve({ code, signal }));
      });

      return {
        stdout: child.stdout,
        stderr: child.stderr,
        onExit,
        kill: () => killChildProcessTree(child),
      } satisfies CodeRabbitSpawnedReviewProcess;
    },
    catch: (cause) =>
      new CodeRabbitRpcError({
        message:
          cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to start CodeRabbit review.",
        reason: "process_failed",
        cause,
      }),
  });
}

export const makeCodeRabbitService = (options: CodeRabbitServiceOptions = {}) =>
  Effect.sync(() => {
    const runCommand = options.runCommand ?? runProcess;
    const now = options.now ?? (() => new Date().toISOString());
    const reviewIdFactory =
      options.reviewIdFactory ??
      (() => CodeRabbitReviewId.makeUnsafe(`crr_${crypto.randomUUID()}`));
    const spawnReviewProcess = options.spawnReviewProcess ?? defaultSpawnReviewProcess;

    const recordsById = new Map<CodeRabbitReviewIdType, ReviewRecord>();
    const activeReviewIdByCwd = new Map<string, CodeRabbitReviewIdType>();
    const latestReviewIdByCwd = new Map<string, CodeRabbitReviewIdType>();
    let cliStatusCache: CliStatusCacheEntry | null = null;

    const getCachedCliStatus = (): Effect.Effect<CliStatus, never> =>
      Effect.promise(async () => {
        const checkedAtMs = Date.now();
        if (cliStatusCache && checkedAtMs - cliStatusCache.checkedAtMs < CLI_STATUS_CACHE_TTL_MS) {
          return cliStatusCache.value;
        }

        let available = false;
        let authenticated = false;

        try {
          const versionResult = await runCommand("coderabbit", ["--version"], {
            timeoutMs: 10_000,
          });
          available = versionResult.code === 0;
        } catch {
          available = false;
        }

        if (available) {
          try {
            const authResult = await runCommand("coderabbit", ["auth", "status", "--agent"], {
              timeoutMs: 10_000,
            });
            authenticated = parseCodeRabbitAuthStatusOutput(authResult.stdout).authenticated;
          } catch {
            authenticated = false;
          }
        }

        const value = {
          available,
          authenticated,
        } satisfies CliStatus;
        cliStatusCache = {
          checkedAtMs,
          value,
        };
        return value;
      }).pipe(Effect.orElseSucceed(() => ({ available: false, authenticated: false })));

    const getReviewRecord = (
      input: CodeRabbitGetReviewInput,
    ): Effect.Effect<ReviewRecord, CodeRabbitRpcError> => {
      const record = recordsById.get(input.reviewId);
      return record
        ? Effect.succeed(record)
        : Effect.fail(
            new CodeRabbitRpcError({
              message: `CodeRabbit review ${input.reviewId} was not found.`,
              reason: "review_not_found",
            }),
          );
    };

    const publishEvent = (record: ReviewRecord, event: CodeRabbitReviewEvent) =>
      PubSub.publish(record.pubsub, event).pipe(Effect.asVoid);

    const closeActiveReviewForCwd = (record: ReviewRecord) => {
      if (activeReviewIdByCwd.get(record.snapshot.cwd) === record.reviewId) {
        activeReviewIdByCwd.delete(record.snapshot.cwd);
      }
    };

    const updateSnapshot = (
      record: ReviewRecord,
      patch: Partial<CodeRabbitReviewSnapshot>,
    ): CodeRabbitReviewSnapshot => {
      record.snapshot = {
        ...record.snapshot,
        ...patch,
        updatedAt: now(),
      };
      return record.snapshot;
    };

    const finishCancelled = (
      record: ReviewRecord,
      reason: string,
    ): Effect.Effect<void, never, never> => {
      if (isTerminalPhase(record.snapshot.phase)) {
        return Effect.void;
      }
      const snapshot = updateSnapshot(record, {
        phase: "cancelled",
        statusText: "cancelled",
        completedAt: now(),
        errorMessage: null,
      });
      closeActiveReviewForCwd(record);
      record.process = null;
      const event = {
        type: "cancelled" as const,
        reviewId: record.reviewId,
        timestamp: now(),
        reason,
        snapshot: cloneSnapshot(snapshot),
      };
      record.lastTerminalEvent = event;
      return publishEvent(record, event).pipe(
        Effect.andThen(PubSub.shutdown(record.pubsub)),
        Effect.catch(() => Effect.void),
      );
    };

    const finishCompleted = (record: ReviewRecord): Effect.Effect<void, never, never> => {
      if (isTerminalPhase(record.snapshot.phase)) {
        return Effect.void;
      }
      const snapshot = updateSnapshot(record, {
        phase: "completed",
        statusText: "review_completed",
        completedAt: now(),
        errorMessage: null,
      });
      closeActiveReviewForCwd(record);
      record.process = null;
      const event = {
        type: "completed" as const,
        reviewId: record.reviewId,
        timestamp: now(),
        snapshot: cloneSnapshot(snapshot),
      };
      record.lastTerminalEvent = event;
      return publishEvent(record, event).pipe(
        Effect.andThen(PubSub.shutdown(record.pubsub)),
        Effect.catch(() => Effect.void),
      );
    };

    const finishErrored = (
      record: ReviewRecord,
      message: string,
    ): Effect.Effect<void, never, never> => {
      if (isTerminalPhase(record.snapshot.phase)) {
        return Effect.void;
      }
      const snapshot = updateSnapshot(record, {
        phase: "errored",
        statusText: "review_failed",
        completedAt: now(),
        errorMessage: message,
      });
      closeActiveReviewForCwd(record);
      record.process = null;
      const event = {
        type: "errored" as const,
        reviewId: record.reviewId,
        timestamp: now(),
        message,
        snapshot: cloneSnapshot(snapshot),
      };
      record.lastTerminalEvent = event;
      return publishEvent(record, event).pipe(
        Effect.andThen(PubSub.shutdown(record.pubsub)),
        Effect.catch(() => Effect.void),
      );
    };

    const markDegraded = (record: ReviewRecord) => {
      const snapshot = updateSnapshot(record, {
        degraded: true,
        statusText: "Some review data could not be parsed.",
      });
      const event = {
        type: "status_updated" as const,
        reviewId: record.reviewId,
        timestamp: now(),
        phase: snapshot.phase,
        statusText: snapshot.statusText,
        degraded: true,
      };
      return publishEvent(record, event).pipe(Effect.catch(() => Effect.void));
    };

    const attachLineReader = (
      stream: NodeJS.ReadableStream,
      onLine: (line: string) => Promise<void>,
    ) => {
      const reader = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });
      let lineChain = Promise.resolve();
      reader.on("line", (line) => {
        lineChain = lineChain.then(() => onLine(line)).catch(() => undefined);
      });
      return reader;
    };

    const handleCliLine = async (
      record: ReviewRecord,
      line: string,
      streamKind: "stdout" | "stderr",
    ) => {
      if (streamKind === "stdout") {
        pushBufferedLine(record.stdoutLines, line);
      } else {
        pushBufferedLine(record.stderrLines, line);
      }

      const parsed = parseCodeRabbitCliLine(line);
      if (!parsed) {
        return;
      }

      switch (parsed.kind) {
        case "review_context": {
          updateSnapshot(record, {
            currentBranch: parsed.currentBranch,
            baseBranch: parsed.baseBranch ?? record.snapshot.baseBranch,
          });
          return;
        }
        case "status": {
          if (isTerminalPhase(record.snapshot.phase)) {
            return;
          }
          const snapshot = updateSnapshot(record, {
            phase: parsed.phase,
            statusText: parsed.statusText,
          });
          await Effect.runPromise(
            publishEvent(record, {
              type: "status_updated",
              reviewId: record.reviewId,
              timestamp: now(),
              phase: snapshot.phase,
              statusText: snapshot.statusText,
            }),
          ).catch(() => undefined);
          return;
        }
        case "finding": {
          if (record.snapshot.findings.some((finding) => finding.id === parsed.finding.id)) {
            return;
          }
          const finding = {
            ...parsed.finding,
            createdAt: now(),
          } satisfies CodeRabbitFinding;
          const snapshot = updateSnapshot(record, {
            findings: [...record.snapshot.findings, finding],
          });
          await Effect.runPromise(
            publishEvent(record, {
              type: "finding_added",
              reviewId: record.reviewId,
              timestamp: snapshot.updatedAt,
              finding: cloneFinding(finding),
            }),
          ).catch(() => undefined);
          return;
        }
        case "complete":
          await Effect.runPromise(finishCompleted(record)).catch(() => undefined);
          return;
        case "error":
          await Effect.runPromise(finishErrored(record, parsed.message)).catch(() => undefined);
          return;
        case "unknown":
          console.warn("Unknown CodeRabbit CLI event shape", {
            reviewId: record.reviewId,
            rawType: parsed.rawType,
          });
          await Effect.runPromise(markDegraded(record)).catch(() => undefined);
          return;
      }
    };

    const startReviewProcess = (
      record: ReviewRecord,
      input: CodeRabbitStartReviewInput,
    ): Effect.Effect<void, CodeRabbitRpcError> =>
      Effect.gen(function* () {
        const process = yield* spawnReviewProcess(input);
        record.process = process;

        const stdoutReader = attachLineReader(process.stdout, (line) =>
          handleCliLine(record, line, "stdout"),
        );
        const stderrReader = attachLineReader(process.stderr, (line) =>
          handleCliLine(record, line, "stderr"),
        );

        void process.onExit
          .then(async (exit) => {
            stdoutReader.close();
            stderrReader.close();
            if (isTerminalPhase(record.snapshot.phase)) {
              return;
            }
            if (exit.code === 0) {
              await Effect.runPromise(finishCompleted(record)).catch(() => undefined);
              return;
            }
            const message = formatExitFailureMessage(record, exit);
            await Effect.runPromise(finishErrored(record, message)).catch(() => undefined);
          })
          .catch(async (error) => {
            stdoutReader.close();
            stderrReader.close();
            const message =
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : "CodeRabbit review process failed.";
            await Effect.runPromise(finishErrored(record, message)).catch(() => undefined);
          });
      });

    const cancelReviewById = (
      input: CodeRabbitGetReviewInput,
      reason: string,
    ): Effect.Effect<void, CodeRabbitRpcError> =>
      Effect.gen(function* () {
        const record = yield* getReviewRecord(input);
        if (isTerminalPhase(record.snapshot.phase) || record.process === null) {
          return yield* new CodeRabbitRpcError({
            message: `CodeRabbit review ${input.reviewId} is not active.`,
            reason: "review_not_active",
          });
        }
        const process = record.process;
        yield* finishCancelled(record, reason);
        yield* Effect.sync(() => process.kill());
      });

    const startReview = (
      input: CodeRabbitStartReviewInput,
    ): Effect.Effect<CodeRabbitStartReviewResult, CodeRabbitRpcError> =>
      Effect.gen(function* () {
        const cliStatus = yield* getCachedCliStatus();
        if (!cliStatus.available) {
          return yield* new CodeRabbitRpcError({
            message: "CodeRabbit CLI is unavailable.",
            reason: "cli_unavailable",
          });
        }
        if (!cliStatus.authenticated) {
          return yield* new CodeRabbitRpcError({
            message: "CodeRabbit CLI is not authenticated.",
            reason: "not_authenticated",
          });
        }

        const activeReviewId = activeReviewIdByCwd.get(input.cwd);
        if (activeReviewId) {
          yield* cancelReviewById(
            { reviewId: activeReviewId },
            "Replaced by a newer review for the same workspace.",
          ).pipe(Effect.catch(() => Effect.void));
        }

        const reviewId = reviewIdFactory();
        const createdAt = now();
        const pubsub = yield* PubSub.unbounded<CodeRabbitReviewEvent>();
        const record: ReviewRecord = {
          reviewId,
          snapshot: {
            reviewId,
            cwd: input.cwd,
            scope: input.scope,
            phase: "starting",
            statusText: "starting",
            currentBranch: null,
            baseBranch: input.baseBranch ?? null,
            findings: [],
            degraded: false,
            startedAt: createdAt,
            updatedAt: createdAt,
            completedAt: null,
            errorMessage: null,
          },
          pubsub,
          process: null,
          lastTerminalEvent: null,
          stderrLines: [],
          stdoutLines: [],
        };

        recordsById.set(reviewId, record);
        activeReviewIdByCwd.set(input.cwd, reviewId);
        latestReviewIdByCwd.set(input.cwd, reviewId);

        yield* startReviewProcess(record, input).pipe(
          Effect.catch((error) => {
            closeActiveReviewForCwd(record);
            recordsById.delete(reviewId);
            if (latestReviewIdByCwd.get(input.cwd) === reviewId) {
              latestReviewIdByCwd.delete(input.cwd);
            }
            return Effect.fail(error);
          }),
        );

        return { reviewId };
      });

    const cancelReview = (
      input: CodeRabbitCancelReviewInput,
    ): Effect.Effect<void, CodeRabbitRpcError> =>
      cancelReviewById(input, "Cancelled by the user.").pipe(Effect.asVoid);

    const getStatus = (
      input: CodeRabbitGetStatusInput,
    ): Effect.Effect<CodeRabbitReviewStatus, CodeRabbitRpcError> =>
      Effect.gen(function* () {
        const cliStatus = yield* getCachedCliStatus();
        return {
          available: cliStatus.available,
          authenticated: cliStatus.authenticated,
          activeReviewId: activeReviewIdByCwd.get(input.cwd) ?? null,
          latestReviewId: latestReviewIdByCwd.get(input.cwd) ?? null,
        } satisfies CodeRabbitReviewStatus;
      });

    const getReview = (
      input: CodeRabbitGetReviewInput,
    ): Effect.Effect<CodeRabbitReviewSnapshot, CodeRabbitRpcError> =>
      getReviewRecord(input).pipe(Effect.map((record) => cloneSnapshot(record.snapshot)));

    const streamReviewEvents = (
      input: CodeRabbitGetReviewInput,
    ): Stream.Stream<CodeRabbitReviewEvent, CodeRabbitRpcError> =>
      Stream.unwrap(
        getReviewRecord(input).pipe(
          Effect.map((record) => {
            const snapshotEvent: CodeRabbitReviewEvent = {
              type: "snapshot",
              reviewId: record.reviewId,
              timestamp: now(),
              snapshot: cloneSnapshot(record.snapshot),
            };
            if (record.lastTerminalEvent) {
              return Stream.fromIterable([snapshotEvent, record.lastTerminalEvent]);
            }
            return Stream.concat(
              Stream.make(snapshotEvent),
              Stream.fromPubSub(record.pubsub).pipe(
                Stream.takeUntil(
                  (event) =>
                    event.type === "completed" ||
                    event.type === "errored" ||
                    event.type === "cancelled",
                ),
              ),
            );
          }),
        ),
      );

    return {
      startReview,
      cancelReview,
      getStatus,
      getReview,
      streamReviewEvents,
    } satisfies CodeRabbitServiceShape;
  });

export const CodeRabbitServiceLive = Layer.effect(CodeRabbitService, makeCodeRabbitService());
