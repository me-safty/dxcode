import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    diffPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review:diff-preview",
      tag: WS_METHODS.reviewGetDiffPreview,
      staleTimeMs: 5_000,
    }),
    discardChanges: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:discard-changes",
      tag: WS_METHODS.reviewDiscardChanges,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    stagePaths: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:stage-paths",
      tag: WS_METHODS.reviewStagePaths,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    unstagePaths: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:unstage-paths",
      tag: WS_METHODS.reviewUnstagePaths,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    reviewStackEnsure: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review-stack:ensure",
      tag: WS_METHODS.reviewStackEnsure,
    }),
    reviewStackListSnapshots: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review-stack:list-snapshots",
      tag: WS_METHODS.reviewStackListSnapshots,
      staleTimeMs: 2_000,
    }),
    reviewStackGetSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review-stack:get-snapshot",
      tag: WS_METHODS.reviewStackGetSnapshot,
      staleTimeMs: 60_000,
    }),
    reviewStackCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review-stack:cancel",
      tag: WS_METHODS.reviewStackCancel,
    }),
    reviewStackEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:review-stack:events",
      tag: WS_METHODS.reviewStackSubscribeEvents,
    }),
  };
}
