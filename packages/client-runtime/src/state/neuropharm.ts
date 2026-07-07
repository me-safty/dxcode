import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

export function createNeuropharmEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const databaseScheduler = createAtomCommandScheduler();
  const databaseEnvironmentKey = ({ environmentId }: { readonly environmentId: string }) =>
    environmentId;

  return {
    analyze: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:analyze",
      tag: WS_METHODS.neuropharmAnalyze,
    }),
    installBasicsPack: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:install-basics-pack",
      tag: WS_METHODS.neuropharmInstallBasicsPack,
      scheduler: databaseScheduler,
      concurrency: { mode: "serial", key: databaseEnvironmentKey },
    }),
    syncDatabases: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:sync-databases",
      tag: WS_METHODS.neuropharmSyncDatabases,
      scheduler: databaseScheduler,
      concurrency: { mode: "serial", key: databaseEnvironmentKey },
    }),
    downloadDatabases: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:download-databases",
      tag: WS_METHODS.neuropharmDownloadDatabases,
      scheduler: databaseScheduler,
      concurrency: { mode: "serial", key: databaseEnvironmentKey },
    }),
    databaseStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:database-status",
      tag: WS_METHODS.neuropharmDatabaseStatus,
    }),
    searchLocalInteractions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:search-local-interactions",
      tag: WS_METHODS.neuropharmSearchLocalInteractions,
    }),
    compareCompounds: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:neuropharm:compare-compounds",
      tag: WS_METHODS.neuropharmCompareCompounds,
    }),
  };
}
