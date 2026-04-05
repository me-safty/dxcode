/**
 * OpenCodeAdapterLive - OpenCode provider adapter using `opencode run`.
 *
 * Uses `opencode run` CLI command in non-interactive mode instead of
 * spawning a persistent server. This is simpler and more reliable —
 * each turn is a standalone CLI invocation with JSON output.
 *
 * @module OpenCodeAdapterLive
 */
import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { spawn } from "node:child_process";
import { DateTime, Effect, Layer, Queue, Random, Result, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { OpenCodeAdapter, type OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";

const PROVIDER = "opencode" as const;

interface SessionContext {
  session: ProviderSession;
  abortController: AbortController | undefined;
  stopped: boolean;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return fallback;
}

/**
 * Parse an OpenCode model slug ("provider/model") into the format
 * that `opencode run --model` expects: "provider/model".
 */
function formatModelFlag(slug: string): string | undefined {
  if (!slug || slug === "default") return undefined;
  return slug; // opencode run --model accepts "provider/model" directly
}

/**
 * Run `opencode run` with the given prompt and return the output.
 */
async function runOpenCodeCli(input: {
  binaryPath: string;
  prompt: string;
  model: string;
  cwd: string;
  signal: AbortSignal;
}): Promise<{ output: string; exitCode: number }> {
  const args = ["run"];
  const modelFlag = formatModelFlag(input.model);
  if (modelFlag) {
    args.push("--model", modelFlag);
  }
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const onAbort = () => {
      child.kill();
      reject(new Error("Aborted"));
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) {
      child.kill();
      reject(new Error("Aborted"));
      return;
    }

    child.on("error", (err) => {
      input.signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("exit", (code) => {
      input.signal.removeEventListener("abort", onAbort);
      resolve({ output: stdout || stderr, exitCode: code ?? 1 });
    });
  });
}

// ── Adapter implementation ────────────────────────────────────────────

const makeOpenCodeAdapter = Effect.fn("makeOpenCodeAdapter")(function* () {
  const serverSettingsService = yield* ServerSettingsService;
  const sessions = new Map<ThreadId, SessionContext>();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
  const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

  const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

  const getSettings = serverSettingsService.getSettings.pipe(
    Effect.map((s) => s.providers.opencode),
  );

  const getSession = (threadId: ThreadId): Effect.Effect<SessionContext, ProviderAdapterError> => {
    const ctx = sessions.get(threadId);
    if (!ctx)
      return Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    if (ctx.stopped)
      return Effect.fail(new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId }));
    return Effect.succeed(ctx);
  };

  // ── Run turn via `opencode run` ─────────────────────────────────────

  const runTurn = Effect.fn("runTurn")(function* (
    ctx: SessionContext,
    userText: string,
    model: string,
    turnId: TurnId,
  ) {
    const settings = yield* getSettings;
    const cwd = ctx.session.cwd ?? process.cwd();
    const abortController = new AbortController();
    ctx.abortController = abortController;

    // Emit turn started
    const turnStartStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.started",
      eventId: turnStartStamp.eventId,
      provider: PROVIDER,
      createdAt: turnStartStamp.createdAt,
      threadId: ctx.session.threadId,
      turnId,
      payload: { model },
      providerRefs: {},
    });

    // Session state → running
    const runningStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "session.state.changed",
      eventId: runningStamp.eventId,
      provider: PROVIDER,
      createdAt: runningStamp.createdAt,
      threadId: ctx.session.threadId,
      turnId,
      payload: { state: "running" },
      providerRefs: {},
    });
    ctx.session = { ...ctx.session, status: "running" };

    let turnStatus: "completed" | "failed" | "interrupted" = "completed";
    let errorMessage: string | undefined;
    let responseText = "";

    // Run opencode CLI
    const cliResult = yield* Effect.tryPromise({
      try: () =>
        runOpenCodeCli({
          binaryPath: settings.binaryPath,
          prompt: userText,
          model,
          cwd,
          signal: abortController.signal,
        }),
      catch: (err) => err as Error,
    }).pipe(Effect.result);

    if (Result.isFailure(cliResult)) {
      if (abortController.signal.aborted) {
        turnStatus = "interrupted";
        errorMessage = "Request interrupted.";
      } else {
        turnStatus = "failed";
        errorMessage = toMessage(cliResult.failure, "OpenCode CLI failed");
      }
    } else {
      const { output, exitCode } = cliResult.success;
      if (exitCode !== 0) {
        turnStatus = "failed";
        errorMessage = output.trim().length > 0
          ? output.trim()
          : `OpenCode exited with code ${exitCode}`;
      } else {
        responseText = output;
      }
    }

    // Emit assistant message
    if (responseText.length > 0) {
      const itemId = yield* Random.nextUUIDv4;

      const startStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.started",
        eventId: startStamp.eventId,
        provider: PROVIDER,
        createdAt: startStamp.createdAt,
        threadId: ctx.session.threadId,
        turnId,
        itemId: RuntimeItemId.makeUnsafe(itemId),
        payload: {
          itemType: "assistant_message",
          status: "inProgress",
          title: "Assistant message",
        },
        providerRefs: {},
      });

      const deltaStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "content.delta",
        eventId: deltaStamp.eventId,
        provider: PROVIDER,
        createdAt: deltaStamp.createdAt,
        threadId: ctx.session.threadId,
        turnId,
        itemId: RuntimeItemId.makeUnsafe(itemId),
        payload: { streamKind: "assistant_text", delta: responseText },
        providerRefs: {},
      });

      const completeItemStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.completed",
        eventId: completeItemStamp.eventId,
        provider: PROVIDER,
        createdAt: completeItemStamp.createdAt,
        threadId: ctx.session.threadId,
        turnId,
        itemId: RuntimeItemId.makeUnsafe(itemId),
        payload: {
          itemType: "assistant_message",
          status: "completed",
          title: "Assistant message",
          detail: responseText,
        },
        providerRefs: {},
      });
    }

    // Emit error if needed
    if (turnStatus === "failed" && errorMessage) {
      const errorStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "runtime.error",
        eventId: errorStamp.eventId,
        provider: PROVIDER,
        createdAt: errorStamp.createdAt,
        threadId: ctx.session.threadId,
        turnId,
        payload: { message: errorMessage, class: "provider_error" },
        providerRefs: {},
      });
    }

    // Turn completed
    const completeStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.completed",
      eventId: completeStamp.eventId,
      provider: PROVIDER,
      createdAt: completeStamp.createdAt,
      threadId: ctx.session.threadId,
      turnId,
      payload: { state: turnStatus, ...(errorMessage ? { errorMessage } : {}) },
      providerRefs: {},
    });

    // Session → ready
    const updatedAt = yield* nowIso;
    ctx.session = {
      ...ctx.session,
      status: "ready",
      activeTurnId: undefined,
      updatedAt,
      ...(turnStatus === "failed" && errorMessage ? { lastError: errorMessage } : {}),
    };
    ctx.abortController = undefined;

    const readyStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "session.state.changed",
      eventId: readyStamp.eventId,
      provider: PROVIDER,
      createdAt: readyStamp.createdAt,
      threadId: ctx.session.threadId,
      payload: { state: "ready" },
      providerRefs: {},
    });
  });

  // ── ProviderAdapterShape ────────────────────────────────────────────

  const startSession: OpenCodeAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      const threadId = input.threadId;
      const model = input.modelSelection?.model ?? "default";
      const createdAt = yield* nowIso;

      const session: ProviderSession = {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: input.cwd,
        model,
        threadId,
        createdAt,
        updatedAt: createdAt,
      };

      const ctx: SessionContext = {
        session,
        abortController: undefined,
        stopped: false,
      };
      sessions.set(threadId, ctx);

      // Emit session started
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId,
        payload: {},
        providerRefs: {},
      });

      const readyStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.state.changed",
        eventId: readyStamp.eventId,
        provider: PROVIDER,
        createdAt: readyStamp.createdAt,
        threadId,
        payload: { state: "ready" },
        providerRefs: {},
      });

      return session;
    });

  const sendTurn: OpenCodeAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* getSession(input.threadId);
      if (ctx.session.activeTurnId) {
        return yield* Effect.fail(
          new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId: input.threadId,
          }),
        );
      }
      const model = input.modelSelection?.model ?? ctx.session.model ?? "default";
      const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
      const userText = input.input?.trim() ?? "";

      ctx.session = { ...ctx.session, model, activeTurnId: turnId };

      // Run in background
      const services = yield* Effect.services();
      Effect.runForkWith(services)(runTurn(ctx, userText, model, turnId));

      return { threadId: input.threadId, turnId };
    });

  const interruptTurn: OpenCodeAdapterShape["interruptTurn"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* getSession(threadId);
      if (ctx.abortController) ctx.abortController.abort();
    });

  const respondToRequest: OpenCodeAdapterShape["respondToRequest"] = () => Effect.void;
  const respondToUserInput: OpenCodeAdapterShape["respondToUserInput"] = () => Effect.void;

  const stopSession: OpenCodeAdapterShape["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = sessions.get(threadId);
      if (!ctx) return;
      ctx.stopped = true;
      if (ctx.abortController) ctx.abortController.abort();

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.exited",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId,
        payload: { reason: "Session stopped." },
        providerRefs: {},
      });
      sessions.delete(threadId);
    });

  const listSessions: OpenCodeAdapterShape["listSessions"] = () =>
    Effect.sync(() =>
      Array.from(sessions.values())
        .filter((c) => !c.stopped)
        .map((c) => c.session),
    );
  const hasSession: OpenCodeAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => sessions.has(threadId) && !sessions.get(threadId)!.stopped);
  const readThread: OpenCodeAdapterShape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      yield* getSession(threadId);
      return { threadId, turns: [] };
    });
  const rollbackThread: OpenCodeAdapterShape["rollbackThread"] = (threadId) =>
    Effect.gen(function* () {
      yield* getSession(threadId);
      return { threadId, turns: [] };
    });
  const stopAll: OpenCodeAdapterShape["stopAll"] = () =>
    Effect.gen(function* () {
      for (const tid of Array.from(sessions.keys())) yield* stopSession(tid);
    });

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" as const },
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
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies OpenCodeAdapterShape;
});

export const OpenCodeAdapterLive = Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter());
