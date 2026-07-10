import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Socket from "effect/unstable/socket/Socket";
import * as pako from "pako";

import { type CompressionCodec, RpcCompressionCodec } from "@t3tools/contracts";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";

import { cryptoLayer } from "../features/cloud/dpop";
import { managedRelayClientLayer } from "../features/cloud/managedRelayLayer";
import { resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import { tracingLayer } from "../features/observability/tracing";
import * as Persistence from "../persistence/layer";

function configuredRelayUrl(): string {
  return resolveCloudPublicConfig().relay.url ?? "http://relay.invalid";
}

const httpClientLayer = remoteHttpClientLayer(fetch);

// RN gzip codec for the /ws RPC (Fix 1). pako runs synchronously on the JS
// thread; fine for one-shot thread sync.
const pakoCodec: CompressionCodec = {
  compressSync: (b) => pako.gzip(b),
  decompressSync: (b) => pako.inflate(b),
  threshold: 1024,
};
const compressionCodecLayer = Layer.succeed(RpcCompressionCodec, pakoCodec);

type RuntimeLayerSource =
  | ReturnType<typeof managedRelayClientLayer>
  | typeof Socket.layerWebSocketConstructorGlobal
  | typeof compressionCodecLayer
  | typeof cryptoLayer
  | typeof httpClientLayer
  | typeof Persistence.layer
  | typeof tracingLayer;

const runtimeLayer = Layer.mergeAll(
  managedRelayClientLayer(configuredRelayUrl()),
  Socket.layerWebSocketConstructorGlobal,
  compressionCodecLayer,
).pipe(
  Layer.provideMerge(cryptoLayer),
  Layer.provideMerge(httpClientLayer),
  Layer.provideMerge(tracingLayer.pipe(Layer.provide(httpClientLayer))),
  Layer.provideMerge(Persistence.layer),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(runtimeLayer);

export const runtimeContextLayer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
