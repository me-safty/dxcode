import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createDxLocalUpdateEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const singleFlight = {
    mode: "singleFlight" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:dx-local-update:state",
      tag: WS_METHODS.subscribeDxLocalUpdates,
    }),
    check: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:dx-local-update:check",
      tag: WS_METHODS.dxLocalUpdateCheck,
      scheduler,
      concurrency: singleFlight,
    }),
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:dx-local-update:prepare",
      tag: WS_METHODS.dxLocalUpdatePrepare,
      scheduler,
      concurrency: singleFlight,
    }),
    publishAndBuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:dx-local-update:publish-and-build",
      tag: WS_METHODS.dxLocalUpdatePublishAndBuild,
      scheduler,
      concurrency: singleFlight,
    }),
  };
}
