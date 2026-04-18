/**
 * PiAdapterLive — pi coding agent (`pi -p --mode json`) per-turn subprocess.
 *
 * MVP adapter: pi is spawned anew for each `sendTurn` call with `pi -p
 * --mode json --model <model> <prompt>`. stdout is parsed line-by-line as
 * NDJSON and mapped onto the canonical ProviderRuntimeEvent stream. A single
 * subprocess is tracked per-thread so it can be SIGKILL'd on interrupt or
 * session stop.
 *
 * Unsupported features (approvals, structured user-input, rollback, thread
 * resume) fail fast with ProviderAdapterRequestError; `readThread` returns an
 * empty snapshot since pi does not persist across our session boundary in
 * this slice.
 *
 * @module PiAdapterLive
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "pi" as const;
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export interface PiAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PiTurnContext {
  readonly turnId: TurnId;
  readonly child: ChildProcess;
  /** Set true once we have emitted a terminal turn event (completed / aborted / failed). */
  settled: boolean;
  /** Text accumulated from assistant message_end events, joined and emitted as content deltas. */
  assistantTextEmitted: boolean;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  activeTurn: PiTurnContext | undefined;
  stopped: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAssistantText(message: unknown): string {
  if (!isRecord(message)) return "";
  const content = message.content;
  if (!Array.isArray(content)) return "";
  const parts: Array<string> = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function extractMessageRole(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  if (typeof message.role === "string") return message.role;
  return undefined;
}

function extractStopReason(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  if (typeof message.stopReason === "string" && message.stopReason.trim().length > 0) {
    return message.stopReason.trim();
  }
  return undefined;
}

function extractErrorMessage(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.errorMessage === "string" && raw.errorMessage.trim().length > 0) {
    return raw.errorMessage.trim();
  }
  const message = raw.message;
  if (isRecord(message)) {
    if (typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0) {
      return message.errorMessage.trim();
    }
    if (typeof message.error === "string" && message.error.trim().length > 0) {
      return message.error.trim();
    }
  }
  if (typeof raw.error === "string" && raw.error.trim().length > 0) {
    return raw.error.trim();
  }
  return undefined;
}

function buildEventBase(input: {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly raw?: unknown;
}): Pick<
  ProviderRuntimeEvent,
  "eventId" | "provider" | "threadId" | "createdAt" | "turnId" | "raw"
> {
  return {
    eventId: EventId.make(randomUUID()),
    provider: PROVIDER,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.raw !== undefined
      ? {
          // pi's NDJSON lines are not in the RuntimeEventRawSource union, so we
          // deliberately omit `raw` here to stay schema-compatible. Kept this
          // helper shape consistent with the other adapters for future lift.
        }
      : {}),
  };
}

export function makePiAdapterLive(options?: PiAdapterLiveOptions) {
  return Layer.effect(
    PiAdapter,
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const services = yield* Effect.context<never>();
      const nativeEventLogger =
        options?.nativeEventLogger ??
        (options?.nativeEventLogPath !== undefined
          ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
              stream: "native",
            })
          : undefined);

      const sessions = new Map<ThreadId, PiSessionContext>();
      const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();

      const emit = (event: ProviderRuntimeEvent) =>
        PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid);
      const emitPromise = (event: ProviderRuntimeEvent) =>
        emit(event).pipe(Effect.runPromiseWith(services));

      const writeNativeEventBestEffort = (threadId: ThreadId, payload: unknown) => {
        if (!nativeEventLogger) return;
        const observedAt = nowIso();
        void nativeEventLogger
          .write(
            {
              observedAt,
              event: {
                id: randomUUID(),
                kind: "notification",
                provider: PROVIDER,
                createdAt: observedAt,
                method: "pi.cli.stdout",
                threadId,
                payload,
              },
            },
            threadId,
          )
          .pipe(Effect.runPromiseWith(services))
          .catch(() => undefined);
      };

      const requireSession = (threadId: ThreadId) => {
        const ctx = sessions.get(threadId);
        if (!ctx) {
          return Effect.fail(
            new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
          );
        }
        if (ctx.stopped) {
          return Effect.fail(
            new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId }),
          );
        }
        return Effect.succeed(ctx);
      };

      const killTurn = (turn: PiTurnContext, signal: NodeJS.Signals = "SIGKILL") => {
        if (!turn.child.killed) {
          try {
            turn.child.kill(signal);
          } catch {
            // Best effort — process may have already exited.
          }
        }
      };

      const handlePiEvent = (ctx: PiSessionContext, turn: PiTurnContext, raw: unknown) => {
        if (!isRecord(raw)) return;
        writeNativeEventBestEffort(ctx.threadId, raw);

        const kind = typeof raw.type === "string" ? raw.type : undefined;
        switch (kind) {
          case "session":
          case "agent_start":
          case "turn_start":
          case "agent_end":
          case "plan":
          case "plan_mode":
          case "todos":
          case "attachment":
          case "tool_call":
          case "tool_result":
            // MVP: acknowledge by logging only. Richer event mapping can land later.
            return;

          case "message_start":
          case "message_end": {
            const role = extractMessageRole(raw.message);
            if (role !== "assistant") return;

            const text = extractAssistantText(raw.message);
            if (kind === "message_end" && text.length > 0 && !turn.assistantTextEmitted) {
              turn.assistantTextEmitted = true;
              void emitPromise({
                ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta: text,
                },
              }).catch(() => undefined);
            }
            return;
          }

          case "turn_end": {
            if (turn.settled) return;
            turn.settled = true;

            const errorMessage = extractErrorMessage(raw);
            const stopReason = extractStopReason(raw.message);
            const isError =
              errorMessage !== undefined ||
              stopReason === "error" ||
              stopReason === "failed" ||
              stopReason === "failure";

            if (isError) {
              const detail = errorMessage ?? stopReason ?? "pi reported a failure.";
              void emitPromise({
                ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
                type: "turn.completed",
                payload: {
                  state: "failed",
                  ...(stopReason ? { stopReason } : {}),
                  errorMessage: detail,
                },
              }).catch(() => undefined);
            } else {
              void emitPromise({
                ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
                type: "turn.completed",
                payload: {
                  state: "completed",
                  ...(stopReason ? { stopReason } : {}),
                },
              }).catch(() => undefined);
            }
            if (ctx.activeTurn === turn) {
              ctx.activeTurn = undefined;
            }
            return;
          }

          case "error":
          case "agent_error": {
            if (turn.settled) return;
            turn.settled = true;
            const detail = extractErrorMessage(raw) ?? "pi emitted an error event.";
            void emitPromise({
              ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
              type: "turn.completed",
              payload: {
                state: "failed",
                errorMessage: detail,
              },
            }).catch(() => undefined);
            if (ctx.activeTurn === turn) {
              ctx.activeTurn = undefined;
            }
            return;
          }

          default:
            // Unknown pi event types are ignored cleanly per the MVP scope.
            return;
        }
      };

      const attachTurnListeners = (
        ctx: PiSessionContext,
        turn: PiTurnContext,
        stderrBuf: { value: string },
      ) => {
        const child = turn.child;
        let stdoutBuffer = "";

        const consumeLines = (flush: boolean): void => {
          while (true) {
            const newlineIndex = stdoutBuffer.indexOf("\n");
            if (newlineIndex === -1) {
              if (flush && stdoutBuffer.trim().length > 0) {
                const line = stdoutBuffer.trim();
                stdoutBuffer = "";
                try {
                  handlePiEvent(ctx, turn, JSON.parse(line));
                } catch {
                  // Non-JSON trailing line — ignore.
                }
              }
              return;
            }
            const rawLine = stdoutBuffer.slice(0, newlineIndex);
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            const trimmed = rawLine.trim();
            if (trimmed.length === 0) continue;
            try {
              handlePiEvent(ctx, turn, JSON.parse(trimmed));
            } catch {
              // Non-JSON noise from pi (e.g. stderr crossovers) — skip.
            }
          }
        };

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdoutBuffer += chunk;
          consumeLines(false);
        });
        child.stderr?.on("data", (chunk: string) => {
          stderrBuf.value += chunk;
        });

        child.once("error", (err) => {
          if (turn.settled) return;
          turn.settled = true;
          void emitPromise({
            ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
            type: "turn.completed",
            payload: {
              state: "failed",
              errorMessage: err.message.trim() || "pi subprocess errored.",
            },
          }).catch(() => undefined);
          if (ctx.activeTurn === turn) {
            ctx.activeTurn = undefined;
          }
        });

        child.once("exit", (code, signal) => {
          consumeLines(true);
          if (turn.settled) {
            if (ctx.activeTurn === turn) ctx.activeTurn = undefined;
            return;
          }
          turn.settled = true;
          // pi may have exited without a turn_end event (e.g. crash, SIGKILL).
          if (signal === "SIGKILL" || signal === "SIGTERM") {
            void emitPromise({
              ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
              type: "turn.completed",
              payload: {
                state: "interrupted",
                stopReason: "interrupted",
              },
            }).catch(() => undefined);
          } else {
            const detail =
              stderrBuf.value.trim().length > 0
                ? stderrBuf.value.trim().slice(0, 2000)
                : `pi exited with code ${code ?? "unknown"} and no turn_end event.`;
            void emitPromise({
              ...buildEventBase({ threadId: ctx.threadId, turnId: turn.turnId }),
              type: "turn.completed",
              payload: {
                state: "failed",
                errorMessage: detail,
              },
            }).catch(() => undefined);
          }
          if (ctx.activeTurn === turn) {
            ctx.activeTurn = undefined;
          }
        });
      };

      const startSession: PiAdapterShape["startSession"] = (input) =>
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }

          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            // Kill any running turn from the previous incarnation.
            if (existing.activeTurn) {
              killTurn(existing.activeTurn);
            }
            existing.stopped = true;
            sessions.delete(input.threadId);
          }

          const createdAt = nowIso();
          const modelSelection =
            input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
          const session: ProviderSession = {
            provider: PROVIDER,
            status: "ready",
            runtimeMode: input.runtimeMode,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(modelSelection ? { model: modelSelection.model } : {}),
            threadId: input.threadId,
            createdAt,
            updatedAt: createdAt,
          };

          const ctx: PiSessionContext = {
            threadId: input.threadId,
            session,
            activeTurn: undefined,
            stopped: false,
          };
          sessions.set(input.threadId, ctx);

          yield* emit({
            ...buildEventBase({ threadId: input.threadId }),
            type: "session.started",
            payload: {
              message: "pi session started",
            },
          });
          yield* emit({
            ...buildEventBase({ threadId: input.threadId }),
            type: "session.state.changed",
            payload: { state: "ready", reason: "pi session ready" },
          });
          yield* emit({
            ...buildEventBase({ threadId: input.threadId }),
            type: "thread.started",
            payload: {},
          });

          return session;
        });

      const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(input.threadId);

          const prompt = input.input?.trim();
          if (!prompt || prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "pi turns require non-empty text input (attachments not supported in MVP).",
            });
          }

          const modelSelection =
            input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
          const model = modelSelection?.model ?? ctx.session.model ?? DEFAULT_MODEL;

          const piSettings = yield* serverSettings.getSettings.pipe(
            Effect.map((s) => s.providers.pi),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          const binaryPath = piSettings.binaryPath.trim().length > 0 ? piSettings.binaryPath : "pi";

          const turnId = TurnId.make(`pi-turn-${randomUUID()}`);
          const args = ["-p", "--mode", "json", "--model", model, prompt];

          const child: ChildProcess = yield* Effect.try({
            try: () =>
              spawn(binaryPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
                env: process.env,
                ...(ctx.session.cwd ? { cwd: ctx.session.cwd } : {}),
              }),
            catch: (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause instanceof Error ? cause.message : "Failed to spawn pi.",
                cause,
              }),
          });

          const turn: PiTurnContext = {
            turnId,
            child,
            settled: false,
            assistantTextEmitted: false,
          };
          ctx.activeTurn = turn;
          ctx.session = {
            ...ctx.session,
            status: "running",
            activeTurnId: turnId,
            model,
            updatedAt: nowIso(),
          };

          yield* emit({
            ...buildEventBase({ threadId: input.threadId, turnId }),
            type: "turn.started",
            payload: { model },
          });

          attachTurnListeners(ctx, turn, { value: "" });

          return {
            threadId: input.threadId,
            turnId,
          };
        });

      const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId, turnId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          const active = ctx.activeTurn;
          if (!active) return;
          if (turnId !== undefined && active.turnId !== turnId) return;
          killTurn(active);
          // Exit handler will emit turn.completed{state: "interrupted"}.
        });

      const respondToRequest: PiAdapterShape["respondToRequest"] = () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: "pi does not yet support interactive approvals",
          }),
        );

      const respondToUserInput: PiAdapterShape["respondToUserInput"] = () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: "pi does not yet support structured user input",
          }),
        );

      const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
        Effect.gen(function* () {
          const ctx = sessions.get(threadId);
          if (!ctx) {
            return yield* new ProviderAdapterSessionNotFoundError({
              provider: PROVIDER,
              threadId,
            });
          }
          if (ctx.stopped) return;
          ctx.stopped = true;
          if (ctx.activeTurn) {
            killTurn(ctx.activeTurn);
            ctx.activeTurn = undefined;
          }
          sessions.delete(threadId);
          yield* emit({
            ...buildEventBase({ threadId }),
            type: "session.exited",
            payload: {
              reason: "Session stopped.",
              recoverable: false,
              exitKind: "graceful",
            },
          });
        });

      const listSessions: PiAdapterShape["listSessions"] = () =>
        Effect.sync(() =>
          [...sessions.values()].filter((c) => !c.stopped).map((c) => ({ ...c.session })),
        );

      const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
        Effect.sync(() => {
          const c = sessions.get(threadId);
          return c !== undefined && !c.stopped;
        });

      const readThread: PiAdapterShape["readThread"] = (threadId) =>
        Effect.sync(() => ({ threadId, turns: [] }));

      const rollbackThread: PiAdapterShape["rollbackThread"] = () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rollbackThread",
            detail: "pi does not yet support rollback",
          }),
        );

      const stopAll: PiAdapterShape["stopAll"] = () =>
        Effect.gen(function* () {
          const threadIds = [...sessions.keys()];
          for (const threadId of threadIds) {
            yield* stopSession(threadId).pipe(Effect.ignore);
          }
        });

      const streamEvents = Stream.fromPubSub(runtimeEvents);

      return {
        provider: PROVIDER,
        capabilities: { sessionModelSwitch: "unsupported" },
        startSession,
        sendTurn,
        interruptTurn,
        respondToRequest,
        respondToUserInput,
        stopSession,
        listSessions,
        hasSession,
        readThread,
        rollbackThread,
        stopAll,
        streamEvents,
      } satisfies PiAdapterShape;
    }),
  );
}

export const PiAdapterLive = makePiAdapterLive();
