import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type ModelSelection,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpProtocol from "effect-acp/protocol";

import { ServerConfig } from "../../config.ts";
import * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import { normalizeXAiAcpToolCallState } from "../../provider/acp/XAiAcpExtension.ts";
import { layer as idAllocatorLayer, IdAllocatorV2 } from "../IdAllocator.ts";
import {
  ProviderAdapterV2RuntimePolicy,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2TurnInput,
} from "../ProviderAdapter.ts";
import type { ProviderContinuationRequest } from "../ProviderContinuationRequests.ts";
import {
  AcpProviderCapabilitiesV2,
  acpPostSettleContinuationOfferEvidence,
  acpPostSettleMonitorPromptShouldSuppress,
  acpPostSettleWakeEvidence,
  acpPostSettleWakeShouldBuffer,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
} from "./AcpAdapterV2.ts";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-acp-v2-adapter-",
}).pipe(Layer.provide(NodeServices.layer));

const testLayer = Layer.mergeAll(NodeServices.layer, idAllocatorLayer, serverConfigLayer);
const ACP_TEST_DRIVER = ProviderDriverKind.make("acp-test");
const decodeUnknownJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);

function makeMockRuntime(input: {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly mockAgentPath: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly protocolEvents?: Queue.Queue<EffectAcpProtocol.AcpProtocolLogEvent>;
}): AcpAdapterV2Flavor["makeRuntime"] {
  return (runtimeInput) =>
    Effect.gen(function* () {
      const protocolEvents = input.protocolEvents;
      const protocolLogging =
        protocolEvents === undefined
          ? runtimeInput.protocolLogging
          : {
              ...runtimeInput.protocolLogging,
              logger: (event: EffectAcpProtocol.AcpProtocolLogEvent) =>
                Queue.offer(protocolEvents, event).pipe(
                  Effect.andThen(runtimeInput.protocolLogging.logger?.(event) ?? Effect.void),
                  Effect.asVoid,
                ),
            };
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          ...runtimeInput,
          protocolLogging,
          spawn: {
            command: process.execPath,
            args: [input.mockAgentPath],
            cwd: runtimeInput.cwd,
            env: { T3_ACP_SESSION_LIFECYCLE: "1", ...input.environment },
          },
          authMethodId: "test",
        }).pipe(
          Layer.provide(
            Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
          ),
        ),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
}

function rawProtocolMethod(event: EffectAcpProtocol.AcpProtocolLogEvent): string | undefined {
  if (event.stage !== "raw" || typeof event.payload !== "string") return undefined;
  for (const line of event.payload.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const decoded = Option.getOrUndefined(decodeUnknownJson(trimmed));
    if (typeof decoded === "object" && decoded !== null && "method" in decoded) {
      const method = (decoded as { readonly method?: unknown }).method;
      if (typeof method === "string") return method;
    }
  }
  return undefined;
}

function makeTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly instanceId: ProviderInstanceId;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  readonly now: DateTime.Utc;
  readonly ordinal?: number;
  readonly modelSelection?: ModelSelection;
}): ProviderAdapterV2TurnInput {
  const ordinal = input.ordinal ?? 1;
  const suffix = `${input.threadId}:${ordinal}`;
  const modelSelection =
    input.modelSelection ?? ({ instanceId: input.instanceId, model: "default" } as const);
  return {
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make(`project:${input.threadId}`),
      title: "ACP adapter test",
      providerInstanceId: input.instanceId,
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: input.providerThread.id,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      deletedAt: null,
    },
    threadId: input.threadId,
    runId: RunId.make(`run:${suffix}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt:${suffix}`),
    rootNodeId: NodeId.make(`node:${suffix}`),
    providerThread: input.providerThread,
    message: {
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make(`message:${suffix}`),
      text: "test prompt",
      attachments: [],
    },
    modelSelection,
    runtimePolicy: input.runtimePolicy,
  };
}

describe("AcpAdapterV2", () => {
  it.effect("negotiates and executes optional native session forks through the ACP runtime", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const makeRuntime = makeMockRuntime({ childProcessSpawner, mockAgentPath });

      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          makeRuntime,
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const sourceThreadId = ThreadId.make("thread-acp-native-fork-source");
      const targetThreadId = ThreadId.make("thread-acp-native-fork-target");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const modelSelection = { instanceId, model: "default" } as const;
      const runtime = yield* adapter.openSession({
        threadId: sourceThreadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-native-fork"),
        modelSelection,
        runtimePolicy,
      });

      assert.isTrue(runtime.providerSession.capabilities.threads.canForkThread);
      assert.isTrue(runtime.providerSession.capabilities.threads.canReadThreadSnapshot);

      const sourceProviderThread = yield* runtime.ensureThread({
        threadId: sourceThreadId,
        modelSelection,
        runtimePolicy,
      });
      const forkedProviderThread = yield* runtime.forkThread({
        sourceProviderThread,
        targetThreadId,
      });

      assert.equal(sourceProviderThread.nativeThreadRef?.nativeId, "mock-session-1");
      assert.equal(forkedProviderThread.nativeThreadRef?.nativeId, "mock-session-1-fork");
      assert.equal(forkedProviderThread.appThreadId, targetThreadId);
      assert.equal(forkedProviderThread.forkedFrom?.providerThreadId, sourceProviderThread.id);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("rejects requested options that the active ACP session does not expose", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          makeRuntime: makeMockRuntime({ childProcessSpawner, mockAgentPath }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make("thread-acp-unsupported-option");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const error = yield* adapter
        .openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-acp-unsupported-option"),
          modelSelection: {
            instanceId,
            model: "default",
            options: [{ id: "missing-option", value: "high" }],
          },
          runtimePolicy,
        })
        .pipe(Effect.flip);

      assert.equal(error._tag, "ProviderAdapterOpenSessionError");
      assert.include(String(error.cause), "does not expose requested configuration option(s)");
      assert.include(String(error.cause), "missing-option");
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("reconfigures a loaded ACP session from its own active setup metadata", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          makeRuntime: makeMockRuntime({ childProcessSpawner, mockAgentPath, protocolEvents }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const firstThreadId = ThreadId.make("thread-acp-active-setup:first");
      const secondThreadId = ThreadId.make("thread-acp-active-setup:second");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const initialSelection = { instanceId, model: "default" } satisfies ModelSelection;
      const alternateSelection = {
        instanceId,
        model: "grok-mock-alt",
      } satisfies ModelSelection;
      const originalSelection = { instanceId, model: "grok-build" } satisfies ModelSelection;
      const runtime = yield* adapter.openSession({
        threadId: firstThreadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-active-setup"),
        modelSelection: initialSelection,
        runtimePolicy,
      });
      const firstProviderThread = yield* runtime.ensureThread({
        threadId: firstThreadId,
        modelSelection: initialSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn(
        makeTurnInput({
          threadId: firstThreadId,
          providerThread: firstProviderThread,
          instanceId,
          runtimePolicy,
          modelSelection: alternateSelection,
          now,
        }),
      );
      yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );

      const secondProviderThread: OrchestrationV2ProviderThread = {
        ...firstProviderThread,
        id: ProviderThreadId.make("provider-thread-acp-active-setup:second"),
        appThreadId: secondThreadId,
        nativeThreadRef: {
          driver: ACP_TEST_DRIVER,
          nativeId: "mock-session-2",
          strength: "strong",
        },
        status: "idle",
      };
      yield* runtime.resumeThread({
        providerThread: secondProviderThread,
        modelSelection: alternateSelection,
        runtimePolicy,
      });
      yield* runtime.startTurn(
        makeTurnInput({
          threadId: secondThreadId,
          providerThread: secondProviderThread,
          instanceId,
          runtimePolicy,
          modelSelection: originalSelection,
          now,
          ordinal: 2,
        }),
      );
      yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );

      const setModelRequests = Array.from(yield* Queue.takeAll(protocolEvents)).filter(
        (event) =>
          event.direction === "outgoing" && rawProtocolMethod(event) === "session/set_model",
      );
      assert.lengthOf(setModelRequests, 2);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("cancels pending permission requests while interrupting an ACP turn", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          makeRuntime: makeMockRuntime({
            childProcessSpawner,
            mockAgentPath,
            environment: { T3_ACP_EMIT_TOOL_CALLS: "1" },
          }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make("thread-acp-cancel-permission");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "approval-required",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const modelSelection = { instanceId, model: "default" } as const;
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-cancel-permission"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn(
        makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now }),
      );

      const pendingRequest = Option.getOrThrow(
        yield* runtime.events.pipe(
          Stream.filter(
            (event) =>
              event.type === "runtime_request.updated" && event.runtimeRequest.status === "pending",
          ),
          Stream.runHead,
        ),
      );
      if (
        pendingRequest.type !== "runtime_request.updated" ||
        pendingRequest.runtimeRequest.providerTurnId === null
      ) {
        return yield* Effect.die("Expected a pending ACP permission request with a provider turn");
      }

      yield* runtime.interruptTurn({
        providerThread,
        providerTurnId: pendingRequest.runtimeRequest.providerTurnId,
      });

      const cancelledRequest = Option.getOrThrow(
        yield* runtime.events.pipe(
          Stream.filter(
            (event) =>
              event.type === "runtime_request.updated" &&
              event.runtimeRequest.id === pendingRequest.runtimeRequest.id &&
              event.runtimeRequest.status === "cancelled",
          ),
          Stream.runHead,
        ),
      );
      assert.equal(cancelledRequest.type, "runtime_request.updated");
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("does not release an ACP turn when cancellation is not acknowledged", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const instanceId = ProviderInstanceId.make("acp-test");
      const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          makeRuntime: makeMockRuntime({
            childProcessSpawner,
            mockAgentPath,
            environment: { T3_ACP_PROMPT_DELAY_MS: "5000" },
            protocolEvents,
          }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make("thread-acp-cancel-timeout");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const modelSelection = { instanceId, model: "default" } as const;
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-cancel-timeout"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const firstTurn = makeTurnInput({
        threadId,
        providerThread,
        instanceId,
        runtimePolicy,
        now,
      });
      yield* runtime.startTurn(firstTurn);
      yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) =>
            event.direction === "outgoing" && rawProtocolMethod(event) === "session/prompt",
        ),
        Stream.runHead,
      );
      const providerTurnId = idAllocator.derive.providerTurn({
        driver: ACP_TEST_DRIVER,
        nativeTurnId: "mock-session-1:turn:1",
      });
      const interruptFiber = yield* runtime
        .interruptTurn({ providerThread, providerTurnId })
        .pipe(Effect.flip, Effect.forkScoped);
      yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) =>
            event.direction === "outgoing" && rawProtocolMethod(event) === "session/cancel",
        ),
        Stream.runHead,
      );
      yield* TestClock.adjust("10 seconds");
      const interruptError = yield* Fiber.join(interruptFiber);
      assert.equal(interruptError._tag, "ProviderAdapterInterruptError");

      const secondTurnError = yield* runtime
        .startTurn(
          makeTurnInput({
            threadId,
            providerThread,
            instanceId,
            runtimePolicy,
            now,
            ordinal: 2,
          }),
        )
        .pipe(Effect.flip);
      assert.equal(secondTurnError._tag, "ProviderAdapterTurnStartError");
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("finalizes a settled turn held open for background work when interrupted", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          deferFinalizeForBackgroundWork: true,
          extractSubagentUpdate: (toolCall) =>
            toolCall.toolCallId === "tool-call-generic-1"
              ? {
                  nativeTaskId: "task-generic-1",
                  prompt: "background subagent",
                  title: "background subagent",
                  model: null,
                  status: "running",
                  childSessionId: null,
                  result: null,
                }
              : undefined,
          makeRuntime: makeMockRuntime({
            childProcessSpawner,
            mockAgentPath,
            environment: { T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS: "1" },
            protocolEvents,
          }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make("thread-acp-interrupt-background-hold");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const modelSelection = { instanceId, model: "default" } as const;
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-interrupt-background"),
        modelSelection,
        runtimePolicy,
      });
      const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
      yield* runtime.events.pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped,
      );
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn(
        makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now }),
      );
      // The still-running subagent defers finalize after session/prompt returns.
      yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) =>
            event.direction === "incoming" &&
            event.stage === "raw" &&
            typeof event.payload === "string" &&
            event.payload.includes('"stopReason"'),
        ),
        Stream.runHead,
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const providerTurnId = idAllocator.derive.providerTurn({
        driver: ACP_TEST_DRIVER,
        nativeTurnId: "mock-session-1:turn:1",
      });
      const interruptFiber = yield* runtime
        .interruptTurn({ providerThread, providerTurnId })
        .pipe(Effect.forkScoped);
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(interruptFiber);

      let terminalStatus: string | null = null;
      while (terminalStatus === null) {
        const event = yield* Queue.take(events);
        if (event.type === "turn.terminal" && event.providerTurnId === providerTurnId) {
          terminalStatus = event.status;
        }
      }
      assert.equal(terminalStatus, "interrupted");
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect(
    "carries a live subagent lineage across an interrupt so the next turn can complete it",
    () =>
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const idAllocator = yield* IdAllocatorV2;
        const path = yield* Path.Path;
        const serverConfig = yield* ServerConfig;
        const mockAgentPath = yield* path.fromFileUrl(
          new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
        );
        const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
        const instanceId = ProviderInstanceId.make("acp-test");
        let subagentPhase: "spawn" | "complete" = "spawn";
        const adapter = makeAcpAdapterV2({
          instanceId,
          flavor: {
            driver: ACP_TEST_DRIVER,
            capabilities: AcpProviderCapabilitiesV2,
            deferFinalizeForBackgroundWork: true,
            extractSubagentUpdate: (toolCall) =>
              toolCall.toolCallId !== "tool-call-generic-1"
                ? undefined
                : subagentPhase === "spawn"
                  ? {
                      nativeTaskId: "task-generic-1",
                      prompt: "background subagent",
                      title: "background subagent",
                      model: null,
                      status: "running",
                      childSessionId: null,
                      result: null,
                    }
                  : // Hydration-only shape (empty prompt, null title): without a
                    // carried-over lineage this update is dropped and the item
                    // stays running forever.
                    {
                      nativeTaskId: "task-generic-1",
                      prompt: "",
                      title: null,
                      model: null,
                      status: "completed",
                      childSessionId: null,
                      result: "SUB_DONE",
                    },
            makeRuntime: makeMockRuntime({
              childProcessSpawner,
              mockAgentPath,
              environment: { T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS: "1" },
              protocolEvents,
            }),
          },
          fileSystem,
          idAllocator,
          serverConfig,
        });
        const threadId = ThreadId.make("thread-acp-subagent-carryover");
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "default" } as const;
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-acp-subagent-carryover"),
          modelSelection,
          runtimePolicy,
        });
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        yield* runtime.events.pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        );
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* runtime.startTurn(
          makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now }),
        );
        yield* Stream.fromQueue(protocolEvents).pipe(
          Stream.filter(
            (event) =>
              event.direction === "incoming" &&
              event.stage === "raw" &&
              typeof event.payload === "string" &&
              event.payload.includes('"stopReason"'),
          ),
          Stream.runHead,
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const firstProviderTurnId = idAllocator.derive.providerTurn({
          driver: ACP_TEST_DRIVER,
          nativeTurnId: "mock-session-1:turn:1",
        });
        const interruptFiber = yield* runtime
          .interruptTurn({ providerThread, providerTurnId: firstProviderTurnId })
          .pipe(Effect.forkScoped);
        yield* TestClock.adjust("10 seconds");
        yield* Fiber.join(interruptFiber);

        let subagentTurnItemId: string | null = null;
        let firstTerminalStatus: string | null = null;
        while (firstTerminalStatus === null) {
          const event = yield* Queue.take(events);
          if (event.type === "turn_item.updated" && event.turnItem.type === "subagent") {
            subagentTurnItemId = event.turnItem.id;
          }
          if (event.type === "turn.terminal" && event.providerTurnId === firstProviderTurnId) {
            firstTerminalStatus = event.status;
          }
        }
        assert.equal(firstTerminalStatus, "interrupted");
        assert.notEqual(subagentTurnItemId, null);

        subagentPhase = "complete";
        const secondNow = yield* DateTime.now;
        yield* runtime.startTurn(
          makeTurnInput({
            threadId,
            providerThread,
            instanceId,
            runtimePolicy,
            now: secondNow,
            ordinal: 2,
          }),
        );
        const secondProviderTurnId = idAllocator.derive.providerTurn({
          driver: ACP_TEST_DRIVER,
          nativeTurnId: "mock-session-1:turn:2",
        });
        let carriedItemStatus: string | null = null;
        let secondTerminalStatus: string | null = null;
        while (secondTerminalStatus === null) {
          const event = yield* Queue.take(events);
          if (
            event.type === "turn_item.updated" &&
            event.turnItem.type === "subagent" &&
            event.turnItem.id === subagentTurnItemId
          ) {
            carriedItemStatus = event.turnItem.status;
          }
          if (event.type === "turn.terminal" && event.providerTurnId === secondProviderTurnId) {
            secondTerminalStatus = event.status;
          }
        }
        assert.equal(carriedItemStatus, "completed");
        assert.equal(secondTerminalStatus, "completed");
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect(
    "does not pin hasPendingBackgroundWork when a late TaskOutput re-reports an in-turn-handled task",
    () =>
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const idAllocator = yield* IdAllocatorV2;
        const path = yield* Path.Path;
        const serverConfig = yield* ServerConfig;
        const mockAgentPath = yield* path.fromFileUrl(
          new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
        );
        const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
        const continuationRequests: Array<ProviderContinuationRequest> = [];
        const instanceId = ProviderInstanceId.make("acp-test");
        const adapter = makeAcpAdapterV2({
          instanceId,
          flavor: {
            driver: ACP_TEST_DRIVER,
            capabilities: AcpProviderCapabilitiesV2,
            enablePostSettleContinuation: true,
            extractBackgroundTaskId: (toolCall) =>
              toolCall.toolCallId === "tool-call-monitor-1" ? "task-monitor-1" : undefined,
            extractBackgroundTaskCompletion: (toolCall) =>
              toolCall.toolCallId === "tool-call-fetch-1"
                ? {
                    taskId: "task-monitor-1",
                    status: toolCall.status === "completed" ? "completed" : "running",
                    appendOutput: toolCall.status === "completed" ? "MONITOR_LISTING_TOKEN" : "",
                  }
                : undefined,
            makeRuntime: makeMockRuntime({
              childProcessSpawner,
              mockAgentPath,
              environment: {
                T3_ACP_EMIT_IN_TURN_TASKOUTPUT_THEN_LATE_DUPLICATE: "1",
              },
              protocolEvents,
            }),
          },
          fileSystem,
          idAllocator,
          serverConfig,
          continuationRequests: {
            offer: (request) =>
              Effect.sync(() => {
                continuationRequests.push(request);
              }),
          },
        });
        const threadId = ThreadId.make("thread-acp-already-handled-wake-pin");
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "default" } as const;
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make(
            "provider-session-acp-already-handled-wake-pin",
          ),
          modelSelection,
          runtimePolicy,
        });
        if (runtime.hasPendingBackgroundWork === undefined) {
          return yield* Effect.die(
            "ACP runtime must expose hasPendingBackgroundWork when post-settle continuation is enabled.",
          );
        }
        const hasPendingBackgroundWork = runtime.hasPendingBackgroundWork;
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        yield* runtime.events.pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        );
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* runtime.startTurn(
          makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now }),
        );
        const providerTurnId = idAllocator.derive.providerTurn({
          driver: ACP_TEST_DRIVER,
          nativeTurnId: "mock-session-1:turn:1",
        });

        let terminalStatus: string | null = null;
        while (terminalStatus === null) {
          const event = yield* Queue.take(events);
          if (event.type === "turn.terminal" && event.providerTurnId === providerTurnId) {
            terminalStatus = event.status;
          }
        }
        assert.equal(terminalStatus, "completed");

        // Wait for the late post-finalize duplicate TaskOutput frame.
        yield* Stream.fromQueue(protocolEvents).pipe(
          Stream.filter(
            (event) =>
              event.direction === "incoming" &&
              event.stage === "raw" &&
              typeof event.payload === "string" &&
              event.payload.includes("MONITOR_LISTING_TOKEN_LATE"),
          ),
          Stream.runHead,
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        assert.lengthOf(
          continuationRequests,
          0,
          "already-handled late TaskOutput must not open a continuation run",
        );
        assert.isFalse(
          yield* hasPendingBackgroundWork,
          "wake buffer must not stay non-empty and pin idle release after an already-handled re-report",
        );
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect(
    "holds a settled turn until the injected monitor report streams instead of finalizing into it",
    () =>
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const idAllocator = yield* IdAllocatorV2;
        const path = yield* Path.Path;
        const serverConfig = yield* ServerConfig;
        const mockAgentPath = yield* path.fromFileUrl(
          new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
        );
        const triggerDir = yield* fileSystem.makeTempDirectoryScoped();
        const triggerPath = path.join(triggerDir, "report-trigger");
        const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
        const instanceId = ProviderInstanceId.make("acp-test");
        const adapter = makeAcpAdapterV2({
          instanceId,
          flavor: {
            driver: ACP_TEST_DRIVER,
            capabilities: AcpProviderCapabilitiesV2,
            deferFinalizeForBackgroundWork: true,
            extractBackgroundTaskId: (toolCall) =>
              toolCall.toolCallId === "tool-call-monitor-1" ? "task-monitor-1" : undefined,
            extractBackgroundToolMutation: (text) =>
              text.includes('Monitor "task-monitor-1" ended')
                ? { taskId: "task-monitor-1", status: "completed", appendOutput: "" }
                : undefined,
            extractBackgroundTaskCompletion: (toolCall) =>
              toolCall.toolCallId === "tool-call-fetch-1"
                ? {
                    taskId: "task-monitor-1",
                    status: toolCall.status === "completed" ? "completed" : "running",
                    appendOutput: toolCall.status === "completed" ? "MONITOR_LISTING_TOKEN" : "",
                  }
                : undefined,
            makeRuntime: makeMockRuntime({
              childProcessSpawner,
              mockAgentPath,
              environment: {
                T3_ACP_EMIT_POST_SETTLE_MONITOR_FLOW: "1",
                T3_ACP_INJECTED_REPORT_TRIGGER_PATH: triggerPath,
              },
              protocolEvents,
            }),
          },
          fileSystem,
          idAllocator,
          serverConfig,
        });
        const threadId = ThreadId.make("thread-acp-injected-report-hold");
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "default" } as const;
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-acp-injected-report"),
          modelSelection,
          runtimePolicy,
        });
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        yield* runtime.events.pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        );
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* runtime.startTurn(
          makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now }),
        );
        const providerTurnId = idAllocator.derive.providerTurn({
          driver: ACP_TEST_DRIVER,
          nativeTurnId: "mock-session-1:turn:1",
        });

        // Wait (real time) until the post-settle end notice and TaskOutput
        // hydration are ingested: the hydrated monitor card carries the
        // fetched listing.
        let reportSeen = false;
        const trackReport = (event: ProviderAdapterV2Event): void => {
          if (
            event.type === "turn_item.updated" &&
            event.turnItem.type === "assistant_message" &&
            event.turnItem.text.includes("MONITOR_REPORT_TOKEN")
          ) {
            reportSeen = true;
          }
        };
        let hydrated = false;
        while (!hydrated) {
          const event = yield* Queue.take(events);
          if (
            event.type === "turn_item.updated" &&
            event.turnItem.type === "command_execution" &&
            event.turnItem.status === "completed" &&
            (event.turnItem.output ?? "").includes("MONITOR_LISTING_TOKEN")
          ) {
            hydrated = true;
          }
        }
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        // Pre-fix the 2s deferred-finalize debounce fires here and the report
        // streamed by the injected turn afterwards is dropped on the floor.
        yield* TestClock.adjust("3 seconds");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        let drained = yield* Queue.poll(events);
        while (Option.isSome(drained)) {
          trackReport(drained.value);
          assert.notEqual(
            drained.value.type,
            "turn.terminal",
            "deferred finalize must hold while the injected-turn report is owed",
          );
          drained = yield* Queue.poll(events);
        }

        // Release the report, then the normal debounce finalizes the turn.
        yield* fileSystem.writeFileString(triggerPath, "go");
        yield* Stream.fromQueue(protocolEvents).pipe(
          Stream.filter(
            (event) =>
              event.direction === "incoming" &&
              event.stage === "raw" &&
              typeof event.payload === "string" &&
              event.payload.includes("MONITOR_REPORT_TOKEN"),
          ),
          Stream.runHead,
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* TestClock.adjust("3 seconds");

        let terminalStatus: string | null = null;
        while (terminalStatus === null) {
          const event = yield* Queue.take(events);
          trackReport(event);
          if (event.type === "turn.terminal" && event.providerTurnId === providerTurnId) {
            terminalStatus = event.status;
          }
        }
        assert.equal(terminalStatus, "completed");
        assert.isTrue(
          reportSeen,
          "the injected-turn report must project before the turn finalizes",
        );
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("restarts the ACP child process before the next prompt after interrupt", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const protocolEvents = yield* Queue.bounded<EffectAcpProtocol.AcpProtocolLogEvent>(256);
      const instanceId = ProviderInstanceId.make("acp-test");
      const adapter = makeAcpAdapterV2({
        instanceId,
        flavor: {
          driver: ACP_TEST_DRIVER,
          capabilities: AcpProviderCapabilitiesV2,
          restartRuntimeAfterInterrupt: true,
          makeRuntime: makeMockRuntime({
            childProcessSpawner,
            mockAgentPath,
            protocolEvents,
          }),
        },
        fileSystem,
        idAllocator,
        serverConfig,
      });
      const threadId = ThreadId.make("thread-acp-restart-after-interrupt");
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const modelSelection = { instanceId, model: "default" } as const;
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-acp-restart-after-interrupt"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn(
        makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now, ordinal: 1 }),
      );
      yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) =>
            event.direction === "outgoing" && rawProtocolMethod(event) === "session/prompt",
        ),
        Stream.runHead,
      );
      const providerTurnId = idAllocator.derive.providerTurn({
        driver: ACP_TEST_DRIVER,
        nativeTurnId: `${providerThread.nativeThreadRef?.nativeId}:turn:1`,
      });
      yield* runtime.interruptTurn({
        providerThread,
        providerTurnId,
        requestRuntimeRestart: true,
      });
      yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) =>
            event.direction === "outgoing" && rawProtocolMethod(event) === "session/cancel",
        ),
        Stream.runHead,
      );

      yield* runtime.startTurn(
        makeTurnInput({ threadId, providerThread, instanceId, runtimePolicy, now, ordinal: 2 }),
      );
      const loadAfterRestart = yield* Stream.fromQueue(protocolEvents).pipe(
        Stream.filter(
          (event) => event.direction === "outgoing" && rawProtocolMethod(event) === "session/load",
        ),
        Stream.runHead,
      );
      assert.isTrue(
        Option.isSome(loadAfterRestart),
        "post-interrupt startTurn should respawn the runtime and replay session/load",
      );
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});

describe("acpPostSettleWakeEvidence", () => {
  const sessionId = "session-wake";

  it("accepts assistant text and tool updates as wake evidence", () => {
    assert.isTrue(
      acpPostSettleWakeEvidence({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Subagent finished. SUBAGENT_DONE" },
        },
      }),
    );
    assert.isTrue(
      acpPostSettleWakeEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "get_command_or_subagent_output",
          status: "pending",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
  });

  it("rejects monitor end chatter and background mutations", () => {
    assert.isFalse(
      acpPostSettleWakeEvidence({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: 'Monitor "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" ended',
          },
        },
      }),
    );
    assert.isFalse(
      acpPostSettleWakeEvidence(
        {
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "task-1 completed" },
          },
        },
        {
          extractBackgroundToolMutation: () => ({
            taskId: "task-1",
            status: "completed",
            appendOutput: "",
          }),
        },
      ),
    );
  });
});

describe("acpPostSettleContinuationOfferEvidence", () => {
  const sessionId = "session-wake-offer";

  it("offers on assistant text and terminal tool status", () => {
    assert.isTrue(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Background shell finished." },
        },
      }),
    );
    assert.isTrue(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          title: "run_terminal_command",
          status: "completed",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
    assert.isTrue(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-2",
          title: "run_terminal_command",
          status: "failed",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
  });

  it("buffers in-progress tool updates without offering", () => {
    assert.isTrue(
      acpPostSettleWakeEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          title: "run_terminal_command",
          status: "in_progress",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
    assert.isFalse(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          title: "run_terminal_command",
          status: "in_progress",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
    assert.isFalse(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "run_terminal_command",
          status: "pending",
          kind: "other",
          content: [],
          locations: [],
          rawInput: {},
        },
      }),
    );
  });

  it("does not offer filtered monitor chatter", () => {
    assert.isFalse(
      acpPostSettleContinuationOfferEvidence({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: 'Monitor "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" ended',
          },
        },
      }),
    );
  });

  it("does not offer on a normalized monitor start ACK despite raw completed status", () => {
    const monitorStartAck = {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-monitor",
        title: "Tool",
        status: "completed",
        kind: "other",
        content: [],
        locations: [],
        rawInput: { variant: "Monitor", description: "stream test" },
        rawOutput: {
          type: "Monitor",
          taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          timeoutMs: 60000,
        },
      },
    } as const;
    // Raw frame looks terminal; the Grok flavor knows it is a running monitor.
    assert.isTrue(acpPostSettleContinuationOfferEvidence(monitorStartAck));
    assert.isFalse(
      acpPostSettleContinuationOfferEvidence(monitorStartAck, {
        normalizeToolCall: normalizeXAiAcpToolCallState,
      }),
    );
  });
});

describe("acpPostSettleWakeShouldBuffer", () => {
  const sessionId = "session-wake-buffer";

  it("drops agent progress chatter while background work is running", () => {
    for (const sessionUpdate of ["agent_message_chunk", "agent_thought_chunk"] as const) {
      assert.isFalse(
        acpPostSettleWakeShouldBuffer(
          {
            sessionId,
            update: {
              sessionUpdate,
              content: { type: "text", text: "Still running." },
            },
          },
          true,
        ),
      );
    }
  });

  it("retains tool state while running and agent output after completion", () => {
    const agentMessage = {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Monitor finished successfully." },
      },
    } as const;
    const toolUpdate = {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-monitor",
        title: "monitor",
        status: "in_progress",
        kind: "other",
        content: [],
        locations: [],
        rawInput: {},
      },
    } as const;

    assert.isTrue(acpPostSettleWakeShouldBuffer(toolUpdate, true));
    assert.isTrue(acpPostSettleWakeShouldBuffer(agentMessage, false));
  });
});

describe("acpPostSettleMonitorPromptShouldSuppress", () => {
  it("suppresses running monitor prompts but not terminal notices", () => {
    assert.isTrue(
      acpPostSettleMonitorPromptShouldSuppress({ taskId: "task-active", status: "running" }),
    );
    assert.isFalse(
      acpPostSettleMonitorPromptShouldSuppress({ taskId: "task-ended", status: "completed" }),
    );
    assert.isFalse(
      acpPostSettleMonitorPromptShouldSuppress({ taskId: "task-failed", status: "failed" }),
    );
  });
});
