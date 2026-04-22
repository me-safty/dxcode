import type { ServerProvider } from "@t3tools/contracts";
import type { Effect, Stream } from "effect";
import type { ProviderVersionLifecycle } from "../providerVersionLifecycle.ts";

export interface ServerProviderShape {
  readonly versionLifecycle: ProviderVersionLifecycle;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
}
