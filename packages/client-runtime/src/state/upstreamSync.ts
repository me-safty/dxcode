import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createUpstreamSyncEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const singleFlight = {
    mode: "singleFlight" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  const serial = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:upstream-sync:state",
      tag: WS_METHODS.subscribeUpstreamUpdates,
    }),
    check: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:upstream-sync:check",
      tag: WS_METHODS.upstreamCheck,
      scheduler,
      concurrency: singleFlight,
    }),
    dismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:upstream-sync:dismiss",
      tag: WS_METHODS.upstreamDismiss,
      scheduler,
      concurrency: serial,
    }),
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:upstream-sync:prepare",
      tag: WS_METHODS.upstreamPrepare,
      scheduler,
      concurrency: singleFlight,
    }),
    abort: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:upstream-sync:abort",
      tag: WS_METHODS.upstreamAbort,
      scheduler,
      concurrency: singleFlight,
    }),
  };
}
