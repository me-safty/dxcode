import {
  PreviewAutomationClientDisconnectedError,
  PreviewAutomationControlInterruptedError,
  PreviewAutomationExecutionError,
  PreviewAutomationHostNotConnectedError,
  PreviewAutomationInvalidSelectorError,
  PreviewAutomationMalformedResponseError,
  PreviewAutomationNoFocusedOwnerError,
  PreviewAutomationRemoteUnavailableError,
  PreviewAutomationRequestQueueClosedError,
  PreviewAutomationResultTooLargeError,
  PreviewAutomationTabNotFoundError,
  PreviewAutomationTimeoutError,
  PreviewAutomationUnsupportedClientError,
  type PreviewAutomationError,
  type PreviewAutomationOperation,
  type PreviewAutomationOwner,
  type PreviewAutomationOwnerIdentity,
  type PreviewAutomationRequest,
  type PreviewAutomationResponse,
  type PreviewTabId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as McpInvocationContext from "./McpInvocationContext.ts";

export interface PreviewAutomationInvokeInput {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly operation: PreviewAutomationOperation;
  readonly input: unknown;
  readonly tabId?: PreviewTabId;
  readonly timeoutMs?: number;
}

export class PreviewAutomationBroker extends Context.Service<
  PreviewAutomationBroker,
  {
    readonly connect: (
      owner: PreviewAutomationOwner,
    ) => Effect.Effect<Stream.Stream<PreviewAutomationRequest>>;
    readonly reportOwner: (
      owner: PreviewAutomationOwner,
    ) => Effect.Effect<void, PreviewAutomationError>;
    readonly clearOwner: (owner: PreviewAutomationOwnerIdentity) => Effect.Effect<void>;
    readonly respond: (
      response: PreviewAutomationResponse,
    ) => Effect.Effect<void, PreviewAutomationError>;
    readonly invoke: <A = unknown>(
      request: PreviewAutomationInvokeInput,
    ) => Effect.Effect<A, PreviewAutomationError>;
  }
>()("t3/mcp/PreviewAutomationBroker") {}

interface ClientConnection {
  readonly clientId: string;
  readonly queue: Queue.Queue<PreviewAutomationRequest>;
}

interface PendingRequest {
  readonly queue: ClientConnection["queue"];
  readonly deferred: Deferred.Deferred<unknown, PreviewAutomationError>;
  readonly context: PreviewAutomationRequestErrorContext;
}

interface PreviewAutomationRequestErrorContext {
  readonly operation: PreviewAutomationOperation;
  readonly environmentId: McpInvocationContext.McpInvocationScope["environmentId"];
  readonly threadId: McpInvocationContext.McpInvocationScope["threadId"];
  readonly providerSessionId: string;
  readonly providerInstanceId: McpInvocationContext.McpInvocationScope["providerInstanceId"];
  readonly clientId: string;
  readonly requestId: string;
  readonly tabId?: PreviewTabId;
  readonly timeoutMs: number;
  readonly selector?: string;
}

interface BrokerState {
  readonly clients: ReadonlyMap<string, ClientConnection>;
  readonly owners: ReadonlyMap<string, PreviewAutomationOwner>;
  readonly pending: ReadonlyMap<string, PendingRequest>;
  readonly requestSequence: number;
}

const selectorFromInput = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  if ("locator" in input && typeof input.locator === "string") return input.locator;
  if ("selector" in input && typeof input.selector === "string") return input.selector;
  return undefined;
};

const classifyResponseError = (
  context: PreviewAutomationRequestErrorContext,
  error: NonNullable<PreviewAutomationResponse["error"]>,
): PreviewAutomationError => {
  const { selector, ...requestContext } = context;
  const remoteDiagnostics = {
    remoteTag: error._tag,
    remoteMessage: error.message,
    ...(error.detail === undefined ? {} : { remoteDetail: error.detail }),
  };
  switch (error._tag) {
    case "PreviewAutomationNoFocusedOwnerError":
      return new PreviewAutomationNoFocusedOwnerError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationUnsupportedClientError":
      return new PreviewAutomationUnsupportedClientError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationTabNotFoundError":
      return new PreviewAutomationTabNotFoundError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationTimeoutError":
      return new PreviewAutomationTimeoutError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationControlInterruptedError":
      return new PreviewAutomationControlInterruptedError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    case "PreviewAutomationInvalidSelectorError": {
      const detail =
        typeof error.detail === "object" && error.detail !== null ? error.detail : undefined;
      const responseSelector =
        detail &&
        "selector" in detail &&
        typeof detail.selector === "string" &&
        detail.selector.length > 0
          ? detail.selector
          : selector;
      return new PreviewAutomationInvalidSelectorError({
        ...requestContext,
        ...remoteDiagnostics,
        ...(responseSelector === undefined ? {} : { selector: responseSelector }),
      });
    }
    case "PreviewAutomationResultTooLargeError": {
      const detail =
        typeof error.detail === "object" && error.detail !== null ? error.detail : undefined;
      const maximumBytes =
        detail &&
        "maximumBytes" in detail &&
        typeof detail.maximumBytes === "number" &&
        Number.isInteger(detail.maximumBytes) &&
        detail.maximumBytes > 0
          ? detail.maximumBytes
          : undefined;
      return new PreviewAutomationResultTooLargeError({
        ...requestContext,
        ...remoteDiagnostics,
        ...(maximumBytes === undefined ? {} : { maximumBytes }),
      });
    }
    case "PreviewAutomationUnavailableError":
      return new PreviewAutomationRemoteUnavailableError({
        ...requestContext,
        ...remoteDiagnostics,
      });
    default:
      return new PreviewAutomationExecutionError({
        ...requestContext,
        ...remoteDiagnostics,
      });
  }
};

export const make = Effect.gen(function* PreviewAutomationBrokerMake() {
  const state = yield* SynchronizedRef.make<BrokerState>({
    clients: new Map(),
    owners: new Map(),
    pending: new Map(),
    requestSequence: 0,
  });

  const disconnect = Effect.fn("PreviewAutomationBroker.disconnect")(function* (
    clientId: string,
    queue: ClientConnection["queue"],
  ) {
    const toFail = yield* SynchronizedRef.modify(state, (current) => {
      const clients = new Map(current.clients);
      const owners = new Map(current.owners);
      const pending = new Map(current.pending);
      const disconnected: PendingRequest[] = [];
      if (current.clients.get(clientId)?.queue === queue) {
        clients.delete(clientId);
        owners.delete(clientId);
      }
      for (const [requestId, entry] of pending) {
        if (entry.queue === queue) {
          pending.delete(requestId);
          disconnected.push(entry);
        }
      }
      return [disconnected, { ...current, clients, owners, pending }] as const;
    });
    yield* Effect.forEach(
      toFail,
      ({ deferred, context }) =>
        Deferred.fail(deferred, new PreviewAutomationClientDisconnectedError(context)),
      { discard: true },
    );
    yield* Queue.shutdown(queue);
  });

  const connect: PreviewAutomationBroker["Service"]["connect"] = Effect.fn(
    "PreviewAutomationBroker.connect",
  )(function* (owner) {
    const clientId = owner.clientId;
    const queue = yield* Queue.unbounded<import("@t3tools/contracts").PreviewAutomationRequest>();
    const previous = yield* SynchronizedRef.modify(state, (current) => {
      const clients = new Map(current.clients);
      const owners = new Map(current.owners);
      const existingOwner = current.owners.get(clientId);
      clients.set(clientId, { clientId, queue });
      owners.set(
        clientId,
        existingOwner?.environmentId === owner.environmentId &&
          existingOwner.threadId === owner.threadId
          ? { ...existingOwner, supportsAutomation: owner.supportsAutomation }
          : owner,
      );
      return [current.clients.get(clientId), { ...current, clients, owners }] as const;
    });
    if (previous) yield* disconnect(clientId, previous.queue);
    return Stream.fromQueue(queue).pipe(Stream.ensuring(disconnect(clientId, queue)));
  });

  const reportOwner: PreviewAutomationBroker["Service"]["reportOwner"] = Effect.fn(
    "PreviewAutomationBroker.reportOwner",
  )(function* (owner) {
    yield* SynchronizedRef.update(state, (current) => {
      const owners = new Map(current.owners);
      owners.set(owner.clientId, owner);
      return { ...current, owners };
    });
  });

  const clearOwner: PreviewAutomationBroker["Service"]["clearOwner"] = Effect.fn(
    "PreviewAutomationBroker.clearOwner",
  )(function* (owner) {
    yield* SynchronizedRef.update(state, (current) => {
      const currentOwner = current.owners.get(owner.clientId);
      if (
        !currentOwner ||
        currentOwner.environmentId !== owner.environmentId ||
        currentOwner.threadId !== owner.threadId
      ) {
        return current;
      }
      const owners = new Map(current.owners);
      owners.delete(owner.clientId);
      return { ...current, owners };
    });
  });

  const respond: PreviewAutomationBroker["Service"]["respond"] = Effect.fn(
    "PreviewAutomationBroker.respond",
  )(function* (response) {
    const pending = yield* SynchronizedRef.modify(state, (current) => {
      const entry = current.pending.get(response.requestId);
      if (!entry) return [undefined, current] as const;
      const next = new Map(current.pending);
      next.delete(response.requestId);
      return [entry, { ...current, pending: next }] as const;
    });
    if (!pending) return;
    if (response.ok) {
      yield* Deferred.succeed(pending.deferred, response.result);
    } else {
      yield* Deferred.fail(
        pending.deferred,
        response.error
          ? classifyResponseError(pending.context, response.error)
          : new PreviewAutomationMalformedResponseError(pending.context),
      );
    }
  });

  const invoke = Effect.fn("PreviewAutomationBroker.invoke")(function* <A = unknown>(
    input: Parameters<PreviewAutomationBroker["Service"]["invoke"]>[0],
  ): Effect.fn.Return<A, PreviewAutomationError> {
    const current = yield* SynchronizedRef.get(state);
    const candidates = Array.from(current.owners.values())
      .filter(
        (owner) =>
          owner.environmentId === input.scope.environmentId &&
          owner.threadId === input.scope.threadId &&
          owner.supportsAutomation,
      )
      .sort((left, right) => right.focusedAt.localeCompare(left.focusedAt));
    const owner = candidates.find((candidate) => current.clients.has(candidate.clientId));
    if (!owner) {
      const disconnectedOwner = candidates[0];
      if (disconnectedOwner) {
        return yield* new PreviewAutomationHostNotConnectedError({
          operation: input.operation,
          environmentId: input.scope.environmentId,
          threadId: input.scope.threadId,
          providerSessionId: input.scope.providerSessionId,
          providerInstanceId: input.scope.providerInstanceId,
          clientId: disconnectedOwner.clientId,
        });
      }
      return yield* new PreviewAutomationNoFocusedOwnerError({
        operation: input.operation,
        environmentId: input.scope.environmentId,
        threadId: input.scope.threadId,
        providerSessionId: input.scope.providerSessionId,
        providerInstanceId: input.scope.providerInstanceId,
      });
    }
    const connection = current.clients.get(owner.clientId);
    if (!connection) {
      return yield* new PreviewAutomationHostNotConnectedError({
        operation: input.operation,
        environmentId: input.scope.environmentId,
        threadId: input.scope.threadId,
        providerSessionId: input.scope.providerSessionId,
        providerInstanceId: input.scope.providerInstanceId,
        clientId: owner.clientId,
      });
    }
    const timeoutMs = input.timeoutMs ?? 15_000;
    const deferred = yield* Deferred.make<unknown, PreviewAutomationError>();
    const [requestId, requestContext] = yield* SynchronizedRef.modify(state, (next) => {
      const requestId = `preview-${next.requestSequence}`;
      const tabId = input.tabId ?? owner.tabId ?? undefined;
      const selector = selectorFromInput(input.input);
      const context: PreviewAutomationRequestErrorContext = {
        operation: input.operation,
        environmentId: input.scope.environmentId,
        threadId: input.scope.threadId,
        providerSessionId: input.scope.providerSessionId,
        providerInstanceId: input.scope.providerInstanceId,
        clientId: owner.clientId,
        requestId,
        ...(tabId === undefined ? {} : { tabId }),
        timeoutMs,
        ...(selector === undefined ? {} : { selector }),
      };
      const pending = new Map(next.pending);
      pending.set(requestId, { queue: connection.queue, deferred, context });
      return [
        [requestId, context] as const,
        { ...next, pending, requestSequence: next.requestSequence + 1 },
      ] as const;
    });
    const removePending = SynchronizedRef.update(state, (next) => {
      if (!next.pending.has(requestId)) return next;
      const pending = new Map(next.pending);
      pending.delete(requestId);
      return { ...next, pending };
    });
    const awaitResponse = Effect.fn("PreviewAutomationBroker.awaitResponse")(function* () {
      const offered = yield* Queue.offer(connection.queue, {
        requestId,
        threadId: input.scope.threadId,
        tabId: requestContext.tabId,
        operation: input.operation,
        input: input.input,
        timeoutMs,
      });
      if (!offered) {
        return yield* new PreviewAutomationRequestQueueClosedError(requestContext);
      }
      const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption(timeoutMs));
      return yield* Option.match(result, {
        onNone: () => Effect.fail(new PreviewAutomationTimeoutError(requestContext)),
        onSome: (value) => Effect.succeed(value as A),
      });
    });
    return yield* awaitResponse().pipe(Effect.ensuring(removePending));
  });

  return PreviewAutomationBroker.of({ connect, reportOwner, clearOwner, respond, invoke });
}).pipe(Effect.withSpan("PreviewAutomationBroker.make"));

export const layer = Layer.effect(PreviewAutomationBroker, make);
