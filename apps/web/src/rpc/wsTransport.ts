import {
  WsTransport as BaseWsTransport,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolSocketUrlProvider,
  type WsTransportOptions,
} from "@t3tools/client-runtime";
import { createWsRpcProtocolLayer as createSharedWsRpcProtocolLayer } from "@t3tools/client-runtime";

import { ClientTracingLive } from "../observability/clientTracing";
import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";
import {
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
} from "./wsConnectionState";

function createWsRpcProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  handlers?: WsProtocolLifecycleHandlers,
  options?: {
    readonly trackGlobalConnectionState?: boolean;
    readonly trackGlobalRequestLatency?: boolean;
  },
) {
  const trackGlobalConnectionState = options?.trackGlobalConnectionState !== false;
  const trackGlobalRequestLatency = options?.trackGlobalRequestLatency !== false;
  return createSharedWsRpcProtocolLayer(url, handlers, {
    ...(trackGlobalConnectionState
      ? {
          telemetryLifecycle: {
            onAttempt: recordWsConnectionAttempt,
            onOpen: recordWsConnectionOpened,
            onError: (message: string) => {
              clearAllTrackedRpcRequests();
              recordWsConnectionErrored(message);
            },
            onClose: (
              details: { readonly code: number; readonly reason: string },
              context: { readonly intentional: boolean },
            ) => {
              clearAllTrackedRpcRequests();
              if (context.intentional) {
                return;
              }
              recordWsConnectionClosed(details);
            },
          },
        }
      : {}),
    ...(trackGlobalRequestLatency
      ? {
          requestTelemetry: {
            onRequestSent: trackRpcRequestSent,
            onRequestAcknowledged: acknowledgeRpcRequest,
            onClearTrackedRequests: clearAllTrackedRpcRequests,
          },
        }
      : {}),
  });
}

export interface WebWsTransportOptions {
  readonly trackGlobalConnectionState?: boolean;
  readonly trackGlobalRequestLatency?: boolean;
}

function makeWebWsTransportOptions(options?: WebWsTransportOptions): WsTransportOptions {
  const trackGlobalRequestLatency = options?.trackGlobalRequestLatency !== false;
  return {
    tracingLayer: ClientTracingLive,
    createProtocolLayer: (url, handlers) => createWsRpcProtocolLayer(url, handlers, options),
    ...(trackGlobalRequestLatency ? { onBeforeReconnect: () => clearAllTrackedRpcRequests() } : {}),
  } satisfies WsTransportOptions;
}

export class WsTransport extends BaseWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
    options?: WebWsTransportOptions,
  ) {
    super(url, lifecycleHandlers, makeWebWsTransportOptions(options));
  }
}
