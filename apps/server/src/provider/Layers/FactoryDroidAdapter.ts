/**
 * FactoryDroidAdapterLive - Factory Droid provider adapter.
 *
 * Wraps `droid exec` JSON-RPC protocol behind the shared provider adapter
 * contract. Streams token-level deltas via coalesced `content.delta` events.
 *
 * @module FactoryDroidAdapterLive
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  ApprovalRequestId,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderStartOptions,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import {
  FactoryDroidAdapter,
  type FactoryDroidAdapterShape,
} from "../Services/FactoryDroidAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  FACTORY_DROID_PROVIDER as PROVIDER,
  asObj,
  makeFactoryDroidBaseEvent,
  mapFactoryDroidNotification,
} from "./FactoryDroidRuntimeEvents.ts";
import { JsonRpcProcess } from "./FactoryDroidJsonRpc.ts";
import { TokenCoalescer } from "./FactoryDroidTokenCoalescer.ts";

// ── Constants ─────────────────────────────────────────────────────────

const DELTA_COALESCE_MS = 50;
const IDLE_COMPLETION_MS = 200;

// ── Helpers ───────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function classifyDroidPermissionRequestType(details: Record<string, unknown> | undefined): {
  requestType: CanonicalRequestType;
  detail?: string;
} {
  const type = details?.type as string | undefined;
  switch (type) {
    case "exec":
      return {
        requestType: "command_execution_approval",
        detail: (details?.fullCommand as string) ?? (details?.command as string),
      };
    case "edit":
    case "create":
    case "apply_patch":
      return {
        requestType: "file_change_approval",
        detail: (details?.filePath as string) ?? (details?.fileName as string),
      };
    case "mcp_tool":
      return {
        requestType: "dynamic_tool_call",
        detail: details?.toolName as string,
      };
    default:
      return { requestType: "unknown" };
  }
}

function mapDecisionToSelectedOption(
  decision: ProviderApprovalDecision,
  options: ReadonlyArray<string>,
): string {
  const lower = new Set(options.map((o) => o.toLowerCase()));
  if (decision === "accept" || decision === "acceptForSession") {
    if (lower.has("always_allow")) return "always_allow";
    if (lower.has("allow_once")) return "allow_once";
    return options[0] ?? "always_allow";
  }
  if (lower.has("deny")) return "deny";
  if (lower.has("reject")) return "reject";
  return options[options.length - 1] ?? "deny";
}

function resolveBinaryPath(opts: ProviderStartOptions | undefined): string {
  return (
    opts?.factoryDroid?.binaryPath?.trim() ||
    process.env.T3CODE_FACTORY_DROID_BINARY_PATH?.trim() ||
    "droid"
  );
}

function modelFromSelection(
  sel: { readonly provider: string; readonly model: string } | undefined,
): string | undefined {
  return sel?.provider === PROVIDER ? sel.model : undefined;
}

// ── Session context ───────────────────────────────────────────────────

class SessionContext {
  public initialized = false;
  public stopped = false;
  public turns: Array<{ id: TurnId; items: unknown[] }> = [];
  public activeTurnId: TurnId | null = null;

  public rpc: JsonRpcProcess | null = null;
  public coalescer: TokenCoalescer;

  public pendingApprovals = new Map<
    string,
    {
      readonly requestType: CanonicalRequestType;
      readonly rpcId: string;
      readonly resolve: (decision: ProviderApprovalDecision) => void;
      readonly reject: (e: Error) => void;
    }
  >();

  public pendingUserInputs = new Map<
    string,
    {
      readonly resolve: (answers: ProviderUserInputAnswers) => void;
      readonly reject: (e: Error) => void;
    }
  >();

  public toolUseRegistry = new Map<string, import("./FactoryDroidRuntimeEvents.ts").ToolUseEntry>();

  constructor(
    public session: ProviderSession,
    public providerOptions: ProviderStartOptions | undefined,
    public child: ChildProcessWithoutNullStreams | null,
    emitSync: (e: ProviderRuntimeEvent) => void,
  ) {
    this.coalescer = new TokenCoalescer(DELTA_COALESCE_MS, IDLE_COMPLETION_MS, emitSync, () => {
      const completedTurnId = this.activeTurnId;
      this.activeTurnId = null;
      this.session = {
        ...this.session,
        status: "ready",
        activeTurnId: undefined,
        updatedAt: now(),
      };
      if (!completedTurnId) {
        return;
      }
      emitSync({
        ...makeFactoryDroidBaseEvent(this.session.threadId),
        type: "turn.completed",
        turnId: completedTurnId,
        payload: { state: "completed" },
      } as unknown as ProviderRuntimeEvent);
    });
  }

  public stop(emitExit: boolean, emitSync: (e: ProviderRuntimeEvent) => void): void {
    if (this.stopped) return;
    this.stopped = true;
    this.coalescer.clearTimers();
    if (this.rpc) this.rpc.stop();
    if (this.child && !this.child.killed) this.child.kill();
    this.session = {
      ...this.session,
      status: "closed",
      activeTurnId: undefined,
      updatedAt: now(),
    };
    for (const [, p] of this.pendingApprovals) p.reject(new Error("Session stopped"));
    this.pendingApprovals.clear();
    for (const [, p] of this.pendingUserInputs) p.reject(new Error("Session stopped"));
    this.pendingUserInputs.clear();
    this.toolUseRegistry.clear();
    if (emitExit) {
      emitSync({
        ...makeFactoryDroidBaseEvent(this.session.threadId),
        type: "session.exited",
        payload: { reason: "stopped" },
      } as unknown as ProviderRuntimeEvent);
    }
  }
}

// ── Adapter factory ───────────────────────────────────────────────────

const turnsSnapshot = (c: SessionContext) =>
  c.turns.map((t) => ({ id: t.id, items: t.items as ReadonlyArray<unknown> }));

export interface FactoryDroidAdapterLiveOptions {
  readonly nativeEventLogger?: EventNdjsonLogger;
}

const makeAdapter = (options?: FactoryDroidAdapterLiveOptions) =>
  Effect.gen(function* () {
    const sessions = new Map<ThreadId, SessionContext>();
    const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const emit = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(queue, event).pipe(
        Effect.tap(() =>
          options?.nativeEventLogger ? options.nativeEventLogger.write(event, null) : Effect.void,
        ),
        Effect.asVoid,
      );

    const emitSync = (event: ProviderRuntimeEvent) => {
      void Effect.runPromise(emit(event));
    };

    const requireCtx = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const c = sessions.get(threadId);
        if (!c)
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        if (c.stopped)
          return yield* new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId,
          });
        return c;
      });

    function hasToolUse(notif: Record<string, unknown>): boolean {
      const msg = asObj(notif.message);
      const content = msg && Array.isArray(msg.content) ? msg.content : undefined;
      return content?.some((b: unknown) => asObj(b)?.type === "tool_use") ?? false;
    }

    function setupListener(c: SessionContext, threadId: ThreadId) {
      if (!c.child) return;
      const child = c.child;

      c.rpc = new JsonRpcProcess(
        child,
        (notif) => {
          const nt = notif.type as string;
          const turnId = c.activeTurnId;

          if ((nt === "assistant_text_delta" || nt === "thinking_text_delta") && turnId) {
            const delta = notif.textDelta as string;
            if (nt === "assistant_text_delta") {
              c.coalescer.appendAssistantText(delta, threadId, turnId);
            } else {
              c.coalescer.appendReasoningText(delta, threadId, turnId);
            }
          } else if (nt === "droid_working_state_changed") {
            const st = notif.newState as string;
            if (st === "idle" && turnId) {
              // Do not schedule idle completion while the droid is waiting for
              // a user response to an ask_user or request_permission request.
              // The "idle" state in those cases means "waiting for user" not
              // "finished working".
              if (c.pendingUserInputs.size === 0 && c.pendingApprovals.size === 0) {
                c.coalescer.scheduleIdle(threadId, turnId);
              }
            } else if (st !== "idle") {
              c.coalescer.clearIdleTimer();
            }
          } else {
            if (nt === "create_message") {
              if (hasToolUse(notif)) {
                c.coalescer.flushDeltas(threadId, turnId);
              }
              const activeTurn = turnId ? c.turns.find((t) => t.id === turnId) : undefined;
              if (activeTurn) {
                activeTurn.items.push(notif.message ?? notif);
              }
            }
            const { events, fallbackText } = mapFactoryDroidNotification({
              notif,
              sawAssistantTextDelta: c.coalescer.sawDelta,
              threadId,
              toolUseRegistry: c.toolUseRegistry,
              ...(turnId ? { turnId } : {}),
            });
            for (const e of events) emitSync(e);
            if (fallbackText && turnId) {
              c.coalescer.appendAssistantText(fallbackText, threadId, turnId);
            }
            // Increment segment AFTER mapFactoryDroidNotification so that
            // sawDelta is still accurate when evaluating create_message text
            // blocks. Previously this ran first, resetting sawDelta to false,
            // which caused fallbackText to re-emit text that was already
            // streamed via assistant_text_delta.
            if (nt === "create_message" && hasToolUse(notif)) {
              c.coalescer.incrementSegment();
            }
          }
        },
        (method, id, params) => {
          // Both ask_user and request_permission mean the droid is actively
          // waiting for user interaction — clear any pending idle timer.
          if (method === "droid.request_permission" || method === "droid.ask_user") {
            c.coalescer.clearIdleTimer();
          }

          if (method === "droid.request_permission") {
            if (c.session.runtimeMode === "full-access") {
              c.rpc?.sendResponse(id, { selectedOption: "always_allow" });
              return;
            }
            const requestId = ApprovalRequestId.makeUnsafe(randomUUID());
            const toolUses = Array.isArray(params?.toolUses) ? params.toolUses : [];
            const options = Array.isArray(params?.options)
              ? (params.options as string[])
              : ["always_allow", "deny"];

            const firstToolUse = asObj(toolUses[0] as Record<string, unknown>);
            const details = asObj(firstToolUse?.details as Record<string, unknown>);
            const { requestType, detail } = classifyDroidPermissionRequestType(details);
            const turnId = c.activeTurnId;

            const promise = new Promise<ProviderApprovalDecision>((resolve, reject) => {
              c.pendingApprovals.set(requestId, {
                requestType,
                rpcId: id,
                resolve,
                reject,
              });
            });

            emitSync({
              ...makeFactoryDroidBaseEvent(threadId),
              ...(turnId ? { turnId } : {}),
              type: "request.opened",
              requestId,
              payload: {
                requestType,
                ...(detail ? { detail } : {}),
              },
            } as unknown as ProviderRuntimeEvent);

            void promise.then(
              (decision) => {
                emitSync({
                  ...makeFactoryDroidBaseEvent(threadId),
                  ...(turnId ? { turnId } : {}),
                  type: "request.resolved",
                  requestId,
                  payload: { requestType, decision },
                } as unknown as ProviderRuntimeEvent);
                c.rpc?.sendResponse(id, {
                  selectedOption: mapDecisionToSelectedOption(decision, options),
                });
              },
              () => {
                emitSync({
                  ...makeFactoryDroidBaseEvent(threadId),
                  ...(turnId ? { turnId } : {}),
                  type: "request.resolved",
                  requestId,
                  payload: { requestType, decision: "cancel" },
                } as unknown as ProviderRuntimeEvent);
                c.rpc?.sendResponse(id, {
                  selectedOption: mapDecisionToSelectedOption("cancel", options),
                });
              },
            );
          } else if (method === "droid.ask_user") {
            const requestId = ApprovalRequestId.makeUnsafe(randomUUID());
            const rawQuestions = Array.isArray(params.questions) ? params.questions : [];

            const questions: UserInputQuestion[] = rawQuestions
              .map((q: Record<string, unknown>, idx: number) => {
                const qId = typeof q.id === "string" ? q.id : `q-${idx}`;
                const index = typeof q.index === "number" ? q.index : idx + 1;
                const header =
                  typeof q.header === "string"
                    ? q.header
                    : typeof q.topic === "string"
                      ? q.topic
                      : `Question ${index}`;
                const question =
                  typeof q.question === "string"
                    ? q.question
                    : typeof q.text === "string"
                      ? q.text
                      : "";
                const options = Array.isArray(q.options)
                  ? (q.options as Array<Record<string, unknown> | string>).map((opt) => {
                      if (typeof opt === "string") return { label: opt, description: "" };
                      return {
                        label: typeof opt.label === "string" ? opt.label : String(opt),
                        description: typeof opt.description === "string" ? opt.description : "",
                      };
                    })
                  : [];
                return { id: qId, header, question, options };
              })
              .filter((q: UserInputQuestion) => q.question.length > 0);

            if (questions.length === 0 || c.stopped) {
              c.rpc?.sendResponse(id, { cancelled: true, answers: [] });
              return;
            }

            const promise = new Promise<ProviderUserInputAnswers>((resolve, reject) => {
              c.pendingUserInputs.set(requestId, { resolve, reject });
            });

            const turnId = c.activeTurnId;
            emitSync({
              ...makeFactoryDroidBaseEvent(threadId),
              ...(turnId ? { turnId } : {}),
              type: "user-input.requested",
              requestId,
              payload: { questions },
              providerRefs: turnId ? { providerTurnId: turnId } : undefined,
              raw: {
                source: "factorydroid.jsonrpc.request",
                method: "droid.ask_user",
                payload: params,
              },
            } as unknown as ProviderRuntimeEvent);

            void promise.then(
              (answers) => {
                emitSync({
                  ...makeFactoryDroidBaseEvent(threadId),
                  ...(turnId ? { turnId } : {}),
                  type: "user-input.resolved",
                  requestId,
                  payload: { answers },
                  providerRefs: turnId ? { providerTurnId: turnId } : undefined,
                  raw: {
                    source: "factorydroid.jsonrpc.request",
                    method: "droid.ask_user/resolved",
                    payload: { answers },
                  },
                } as unknown as ProviderRuntimeEvent);

                const droidAnswers: Array<{
                  index: number;
                  question: string;
                  answer: string;
                }> = [];
                for (let i = 0; i < questions.length; i++) {
                  const q = questions[i]!;
                  const rawQ = rawQuestions[i] as Record<string, unknown> | undefined;
                  const answer = answers[q.id];
                  if (answer != null) {
                    droidAnswers.push({
                      index: typeof rawQ?.index === "number" ? rawQ.index : i + 1,
                      question: q.question,
                      answer: String(answer),
                    });
                  }
                }
                c.rpc?.sendResponse(id, {
                  cancelled: false,
                  answers: droidAnswers,
                });
              },
              () => {
                c.rpc?.sendResponse(id, { cancelled: true, answers: [] });
              },
            );
          }
        },
      );

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text && c.activeTurnId) {
          emitSync({
            ...makeFactoryDroidBaseEvent(threadId),
            type: "runtime.error",
            turnId: c.activeTurnId,
            payload: { message: text },
          } as unknown as ProviderRuntimeEvent);
        }
      });

      child.on("exit", (code) => {
        if (c.child !== child) return;
        c.coalescer.clearTimers();
        c.coalescer.flushDeltas(threadId, c.activeTurnId);
        const turnId = c.activeTurnId;
        c.child = null;
        c.initialized = false;
        c.session = {
          ...c.session,
          status: code === 0 ? "ready" : "error",
          activeTurnId: undefined,
          ...(code !== 0 ? { lastError: `droid exec exited with code ${code}` } : {}),
          updatedAt: now(),
        };
        if (turnId) {
          c.activeTurnId = null;
          emitSync({
            ...makeFactoryDroidBaseEvent(threadId),
            type: "turn.completed",
            turnId,
            payload: { state: code === 0 ? "completed" : "failed" },
          } as unknown as ProviderRuntimeEvent);
        }
      });
    }

    async function ensureProcess(c: SessionContext, threadId: ThreadId) {
      if (c.initialized && c.child && !c.child.killed) return;
      const bin = resolveBinaryPath(c.providerOptions);
      const auto = c.session.runtimeMode === "approval-required" ? "low" : "high";
      const child = spawn(
        bin,
        [
          "exec",
          "--output-format",
          "stream-jsonrpc",
          "--input-format",
          "stream-jsonrpc",
          "--auto",
          auto,
        ],
        {
          cwd: c.session.cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      c.child = child;
      setupListener(c, threadId);
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      c.session = { ...c.session, status: "ready", updatedAt: now() };
      await c.rpc?.sendRequest("droid.initialize_session", {
        machineId: os.hostname(),
        sessionId: randomUUID(),
        cwd: c.session.cwd,
        modelId: c.session.model,
        autonomyLevel: auto,
        interactionMode: "default",
      });
      c.initialized = true;
    }

    const startSession: FactoryDroidAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const t = now();
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          model: modelFromSelection(input.modelSelection),
          cwd: input.cwd ?? process.cwd(),
          threadId: input.threadId,
          createdAt: t,
          updatedAt: t,
        };
        sessions.set(
          input.threadId,
          new SessionContext(session, input.providerOptions, null, emitSync),
        );
        yield* emit({
          ...makeFactoryDroidBaseEvent(input.threadId),
          type: "session.started",
          payload: {},
        } as unknown as ProviderRuntimeEvent);
        return { ...session };
      });

    const sendTurn: FactoryDroidAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const c = yield* requireCtx(input.threadId);
        const turnId = TurnId.makeUnsafe(randomUUID());
        const turnModel = modelFromSelection(input.modelSelection);
        if (turnModel && turnModel !== c.session.model)
          c.session = { ...c.session, model: turnModel };
        c.session = {
          ...c.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: now(),
        };
        c.activeTurnId = turnId;
        c.coalescer.resetBuffers();
        c.turns.push({ id: turnId, items: [] });
        yield* emit({
          ...makeFactoryDroidBaseEvent(input.threadId),
          type: "turn.started",
          turnId,
          payload: turnModel ? { model: turnModel } : {},
        } as unknown as ProviderRuntimeEvent);
        yield* Effect.promise(async () => {
          await ensureProcess(c, input.threadId);
          // `interactionMode` is already sent during `initialize_session`.
          // The current Droid CLI rejects `droid.set_interaction_mode` with an
          // uncorrelated `id: null` error response, which leaves the awaited
          // promise unresolved and prevents `add_user_message` from ever
          // executing.
          await c.rpc?.sendRequest("droid.add_user_message", {
            text: input.input ?? "",
          });
        });
        return { threadId: input.threadId, turnId };
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions, ([, c]) => Effect.sync(() => c.stop(false, emitSync)), {
        discard: true,
      }).pipe(Effect.tap(() => Queue.shutdown(queue))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        statelessRecovery: true,
        requiresStreamingDelivery: true,
      },
      startSession,
      sendTurn,
      interruptTurn: (threadId) =>
        Effect.gen(function* () {
          const c = yield* requireCtx(threadId);
          if (c.initialized && c.child && !c.child.killed) {
            yield* Effect.promise(
              () =>
                c.rpc?.sendRequest("droid.interrupt_session", {}).catch(() => {
                  c.child?.kill();
                }) ?? Promise.resolve(),
            );
          } else if (c.child && !c.child.killed) c.child.kill();
        }),
      readThread: (threadId) =>
        requireCtx(threadId).pipe(Effect.map((c) => ({ threadId, turns: turnsSnapshot(c) }))),
      rollbackThread: (threadId, n) =>
        requireCtx(threadId).pipe(
          Effect.map((c) => {
            c.turns.splice(Math.max(0, c.turns.length - n));
            return { threadId, turns: turnsSnapshot(c) };
          }),
        ),
      respondToRequest: (threadId, requestId, decision) =>
        requireCtx(threadId).pipe(
          Effect.flatMap((c) =>
            Effect.sync(() => {
              const pending = c.pendingApprovals.get(requestId);
              if (!pending) {
                throw new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "item/requestApproval/decision",
                  detail: `Unknown pending approval request: ${requestId}`,
                });
              }
              c.pendingApprovals.delete(requestId);
              pending.resolve(decision);
            }),
          ),
        ),
      respondToUserInput: (threadId, requestId, answers) =>
        requireCtx(threadId).pipe(
          Effect.flatMap((c) =>
            Effect.sync(() => {
              const pending = c.pendingUserInputs.get(requestId);
              if (!pending) {
                throw new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "item/tool/respondToUserInput",
                  detail: `Unknown pending user-input request: ${requestId}`,
                });
              }
              c.pendingUserInputs.delete(requestId);
              pending.resolve(answers);
            }),
          ),
        ),
      stopSession: (threadId) =>
        requireCtx(threadId).pipe(Effect.map((c) => c.stop(true, emitSync))),
      listSessions: () =>
        Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session }))),
      hasSession: (threadId) =>
        Effect.sync(() => {
          const c = sessions.get(threadId);
          return c !== undefined && !c.stopped;
        }),
      stopAll: () =>
        Effect.forEach(sessions, ([, c]) => Effect.sync(() => c.stop(true, emitSync)), {
          discard: true,
        }),
      streamEvents: Stream.fromQueue(queue),
    } satisfies FactoryDroidAdapterShape;
  });

export const FactoryDroidAdapterLive = Layer.effect(FactoryDroidAdapter, makeAdapter());

export function makeFactoryDroidAdapterLive(options?: FactoryDroidAdapterLiveOptions) {
  return Layer.effect(FactoryDroidAdapter, makeAdapter(options));
}
