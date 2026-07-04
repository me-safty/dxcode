// Live board state for the board route.
//
// The host's former `workflowEnvironment.board(...)` folded the
// `workflow.subscribeBoard` stream into a `BoardState` through a
// `createEnvironmentRpcSubscriptionAtomFamily`. That host machinery is gone, so
// here we fold the same stream — obtained through the plugin RPC bridge — with
// the ported `applyBoardStreamItem` reducer, exposed as an atom the board route
// reads with `useAtomValue`.

import {
  AsyncResult,
  Atom,
  getConnectionAtomRuntime,
  type PluginWebRpc,
  useAtomValue,
} from "@t3tools/plugin-sdk-web";
import * as Stream from "effect/Stream";
import { useMemo } from "react";

import { WORKFLOW_WS_METHODS } from "../contracts/workflow.ts";
import type { BoardStreamItem } from "../contracts/workflow.ts";
import { applyBoardStreamItem, emptyBoardState, type BoardState } from "./boardState.ts";

// Stable fallback for "no board selected" so the hook can call `useAtomValue`
// unconditionally (React hook rules) without opening a subscription.
const idleBoardStateAtom = Atom.make(() => AsyncResult.initial<BoardState, never>());

/**
 * Build an atom that folds the live board subscription into `BoardState`. Each
 * `boardId` gets its own atom (its own subscription); mounting/unmounting is
 * handled by the atom registry when the hook (un)mounts.
 */
export function makeBoardStateAtom(
  rpc: PluginWebRpc,
  boardId: string,
): Atom.Atom<AsyncResult.AsyncResult<BoardState, unknown>> {
  const runtime = getConnectionAtomRuntime();
  const folded = rpc
    .subscribe(WORKFLOW_WS_METHODS.subscribeBoard, { boardId })
    .pipe(
      Stream.scan(emptyBoardState, (state, item) =>
        applyBoardStreamItem(state, item as BoardStreamItem),
      ),
    );
  // `as never`: `PluginWebRpc.subscribe` types its stream's Effect context (R) as
  // `unknown`, which is wider than the runtime's context, so `runtime.atom` rejects
  // it at the type level. At runtime the subscription is a self-contained websocket
  // stream needing no context, and this is the host's own connection runtime — it
  // runs fine. The cast masks SDK typing imprecision, not a missing service.
  return runtime.atom(folded as never);
}

/**
 * Subscribe to a board's live folded state. Returns `AsyncResult<BoardState>`
 * (Initial while the first snapshot is in flight, Success once folded). Pass
 * `null` when no board is selected.
 */
export function useBoardState(
  rpc: PluginWebRpc,
  boardId: string | null,
): AsyncResult.AsyncResult<BoardState, unknown> {
  const atom = useMemo(
    () => (boardId === null ? idleBoardStateAtom : makeBoardStateAtom(rpc, boardId)),
    [rpc, boardId],
  );
  return useAtomValue(atom);
}
