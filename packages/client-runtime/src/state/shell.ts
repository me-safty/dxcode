import {
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribe } from "../rpc/client.ts";
import { ShellSnapshotLoader } from "./shellSnapshotHttp.ts";
import { applyShellStreamEvent, normalizeShellThreadMembership } from "./shellReducer.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { followStreamInEnvironment } from "./runtime.ts";

export type EnvironmentShellStatus = "empty" | "cached" | "synchronizing" | "live";

export interface EnvironmentShellState {
  readonly snapshot: Option.Option<OrchestrationV2ShellSnapshot>;
  readonly status: EnvironmentShellStatus;
  readonly error: Option.Option<string>;
}

const EMPTY_SHELL_STATE: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

function shellStatusForSnapshot(
  snapshot: Option.Option<OrchestrationV2ShellSnapshot>,
): EnvironmentShellStatus {
  return Option.isSome(snapshot) ? "cached" : "empty";
}

const SHELL_SYNCHRONIZATION_ERROR_MESSAGE = "Could not synchronize environment data.";

export const makeEnvironmentShellState = Effect.fn("EnvironmentShellState.make")(function* () {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ShellSnapshotLoader;
  const environmentId = supervisor.target.environmentId;
  const cachedSnapshot = yield* cache.loadShell(environmentId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached environment shell.").pipe(
        Effect.annotateLogs({
          environmentId,
          ...safeErrorLogAttributes(error),
        }),
        Effect.as(Option.none<OrchestrationV2ShellSnapshot>()),
      ),
    ),
  );
  // Do not paint disk into the visible snapshot up front. A stale warm cache can
  // list more active threads than the server (dropped archive deltas); showing it
  // before the HTTP/socket heal balloons Home, then the heal shrinks the list.
  // Disk is kept for offline / heal-failure fallback only.
  const state = yield* SubscriptionRef.make<EnvironmentShellState>({
    snapshot: Option.none(),
    status: "synchronizing",
    error: Option.none(),
  });
  // When HTTP heal fails we subscribe without afterSequence so the server
  // embeds a full snapshot. That first snapshot must apply even if its sequence
  // is behind the warm disk cache (authoritative server membership).
  const acceptNextSocketSnapshotAuthoritatively = yield* Ref.make(false);
  // True after an authoritative server snapshot (HTTP or socket heal) or any
  // live delta. While true, non-authoritative disk must not replace the list.
  const hasServerBackedSnapshot = yield* Ref.make(false);
  const persistence = yield* Queue.sliding<OrchestrationV2ShellSnapshot>(1);

  const persist = Effect.fn("EnvironmentShellState.persist")(function* (
    snapshot: OrchestrationV2ShellSnapshot,
  ) {
    yield* cache.saveShell(environmentId, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist environment shell cache.").pipe(
          Effect.annotateLogs({
            environmentId,
            ...safeErrorLogAttributes(error),
          }),
        ),
      ),
    );
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce("500 millis"),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  const applyItem = Effect.fn("EnvironmentShellState.applyItem")(function* (
    item: OrchestrationV2ShellStreamItem,
    options?: { readonly authoritative?: boolean; readonly fromDisk?: boolean },
  ) {
    const current = yield* SubscriptionRef.get(state);
    // Hold the last server-backed (or live) list while reconciling. Disk must
    // not overwrite it or Home balloons with stale active membership.
    if (options?.fromDisk === true) {
      const serverBacked = yield* Ref.get(hasServerBackedSnapshot);
      if (serverBacked || Option.isSome(current.snapshot)) {
        return;
      }
    }
    const nextSnapshot =
      item.kind === "snapshot"
        ? Option.match(current.snapshot, {
            // Reject older full snapshots from the live stream so a slow
            // enrichment refresh cannot reintroduce archived threads. HTTP
            // reconnect heals use authoritative:true and always apply.
            onSome: (snapshot) =>
              !options?.authoritative && item.snapshot.snapshotSequence < snapshot.snapshotSequence
                ? null
                : normalizeShellThreadMembership(item.snapshot),
            onNone: () => normalizeShellThreadMembership(item.snapshot),
          })
        : Option.match(current.snapshot, {
            onNone: () => null,
            onSome: (snapshot) =>
              item.sequence > snapshot.snapshotSequence
                ? applyShellStreamEvent(snapshot, item)
                : snapshot,
          });
    if (nextSnapshot === null) {
      return;
    }

    // Disk fallback is provisional only. Authoritative heals and live deltas
    // mark the list as server-backed so later disk paints cannot overwrite it.
    if (options?.fromDisk !== true) {
      yield* Ref.set(hasServerBackedSnapshot, true);
    }

    yield* SubscriptionRef.set(state, {
      snapshot: Option.some(nextSnapshot),
      status: "live",
      error: Option.none(),
    });
    yield* Queue.offer(persistence, nextSnapshot);
  });

  const applyDiskFallback = Effect.gen(function* () {
    if (Option.isNone(cachedSnapshot)) {
      return;
    }
    yield* applyItem({ kind: "snapshot", snapshot: cachedSnapshot.value }, { fromDisk: true });
  });

  const setDisconnected = Effect.gen(function* () {
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      status: shellStatusForSnapshot(current.snapshot),
    }));
    // Truly offline/unavailable only: session is often None while connecting,
    // so disk must not run off session absence alone.
    yield* applyDiskFallback;
  });
  const setSynchronizing = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: "synchronizing" as const,
    error: Option.none(),
  }));
  const setReady = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: Option.isSome(current.snapshot) ? ("live" as const) : ("synchronizing" as const),
    error: Option.none(),
  }));
  const setStreamError = (error: unknown) =>
    Effect.logWarning("Could not synchronize the environment shell.").pipe(
      Effect.annotateLogs({
        environmentId,
        ...safeErrorLogAttributes(error),
      }),
      Effect.andThen(
        SubscriptionRef.update(state, (current) => ({
          ...current,
          status: shellStatusForSnapshot(current.snapshot),
          error: Option.some(SHELL_SYNCHRONIZATION_ERROR_MESSAGE),
        })),
      ),
    );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      // Why HTTP heal is required even with a warm cache:
      // If an archive delta is dropped, later unrelated shell events still
      // advance snapshotSequence. Resuming only via afterSequence then skips
      // the archive forever and keeps the thread on the home list.
      //
      // Do not paint disk when session is still None during online connect
      // setup (lease not ready yet). Disk is only applied from setDisconnected
      // or when a live session fails HTTP heal and needs a provisional list
      // before the socket snapshot.
      yield* SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.empty,
            onSome: () =>
              Stream.unwrap(
                Effect.gen(function* () {
                  // Never resume afterSequence from disk cache alone. A dropped
                  // archive delta plus later events advances snapshotSequence
                  // past the archive, so delta-only resume keeps the thread on
                  // the home list forever. Require a server heal first:
                  // HTTP full snapshot, or a socket-embedded full snapshot.
                  //
                  // While reconciling, keep the previous server-backed snapshot
                  // visible (setSynchronizing only flips status).
                  let healedFromServer = false;
                  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
                  if (Option.isSome(prepared)) {
                    const httpSnapshot = yield* snapshotLoader.load(prepared.value);
                    if (Option.isSome(httpSnapshot)) {
                      yield* applyItem(
                        { kind: "snapshot", snapshot: httpSnapshot.value },
                        { authoritative: true },
                      );
                      healedFromServer = true;
                      // Clear any leftover flag from a prior session that
                      // failed HTTP heal and disconnected before its socket
                      // snapshot arrived.
                      yield* Ref.set(acceptNextSocketSnapshotAuthoritatively, false);
                    }
                  }

                  if (!healedFromServer) {
                    // Prefer holding an existing list over painting disk. Disk
                    // only fills an empty Home when the socket must carry the heal.
                    yield* applyDiskFallback;
                    yield* Ref.set(acceptNextSocketSnapshotAuthoritatively, true);
                  }

                  const live = yield* SubscriptionRef.get(state);
                  const subscribeInput =
                    healedFromServer && Option.isSome(live.snapshot)
                      ? { afterSequence: live.snapshot.value.snapshotSequence }
                      : {};
                  return subscribe(ORCHESTRATION_V2_WS_METHODS.subscribeShell, subscribeInput, {
                    onExpectedFailure: (cause) => setStreamError(Cause.squash(cause)),
                  });
                }),
              ),
          }),
        ),
        Stream.runForEach((item) =>
          Effect.gen(function* () {
            if (item.kind === "snapshot") {
              const acceptAuthoritative = yield* Ref.get(acceptNextSocketSnapshotAuthoritatively);
              if (acceptAuthoritative) {
                yield* Ref.set(acceptNextSocketSnapshotAuthoritatively, false);
                return yield* applyItem(item, { authoritative: true });
              }
            }
            return yield* applyItem(item);
          }),
        ),
      );
    }),
  );
  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  return state;
});

export function shellStateChanges(environmentId: EnvironmentId) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(makeEnvironmentShellState().pipe(Effect.map(SubscriptionRef.changes))),
  );
}

export interface EnvironmentShellSummary {
  readonly hasSnapshot: boolean;
  readonly hasSynchronizingShell: boolean;
  readonly hasCachedShell: boolean;
  readonly hasLiveShell: boolean;
  readonly firstError: string | null;
  readonly latestSnapshotUpdatedAt: string | null;
}

const EMPTY_ENVIRONMENT_SHELL_SUMMARY: EnvironmentShellSummary = Object.freeze({
  hasSnapshot: false,
  hasSynchronizingShell: false,
  hasCachedShell: false,
  hasLiveShell: false,
  firstError: null,
  latestSnapshotUpdatedAt: null,
});

const EMPTY_SERVER_CONFIGS: ReadonlyMap<EnvironmentId, ServerConfig> = new Map();

function shellSummariesEqual(
  left: EnvironmentShellSummary,
  right: EnvironmentShellSummary,
): boolean {
  return (
    left.hasSnapshot === right.hasSnapshot &&
    left.hasSynchronizingShell === right.hasSynchronizingShell &&
    left.hasCachedShell === right.hasCachedShell &&
    left.hasLiveShell === right.hasLiveShell &&
    left.firstError === right.firstError &&
    left.latestSnapshotUpdatedAt === right.latestSnapshotUpdatedAt
  );
}

function mapsEqual<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export function createEnvironmentShellSummaryAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
}) {
  let previousSummary = EMPTY_ENVIRONMENT_SHELL_SUMMARY;
  return Atom.make((get) => {
    let hasSnapshot = false;
    let hasSynchronizingShell = false;
    let hasCachedShell = false;
    let hasLiveShell = false;
    let firstError: string | null = null;
    let latestSnapshotUpdatedAt: string | null = null;

    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const state = get(input.shellStateValueAtom(environmentId));
      hasSynchronizingShell ||= state.status === "synchronizing";
      hasCachedShell ||= state.status === "cached";
      hasLiveShell ||= state.status === "live";
      if (firstError === null) {
        firstError = Option.getOrNull(state.error);
      }
      if (Option.isNone(state.snapshot)) {
        continue;
      }
      hasSnapshot = true;
      const snapshot = state.snapshot.value;
      const updatedAt = snapshot.threads.concat(snapshot.archivedThreads).reduce<string | null>(
        (latest, thread) => {
          const value = DateTime.formatIso(thread.updatedAt);
          return latest === null || value > latest ? value : latest;
        },
        snapshot.projects.reduce<string | null>((latest, project) => {
          return latest === null || project.updatedAt > latest ? project.updatedAt : latest;
        }, null),
      );
      if (
        updatedAt !== null &&
        (latestSnapshotUpdatedAt === null || updatedAt > latestSnapshotUpdatedAt)
      ) {
        latestSnapshotUpdatedAt = updatedAt;
      }
    }

    const next: EnvironmentShellSummary = {
      hasSnapshot,
      hasSynchronizingShell,
      hasCachedShell,
      hasLiveShell,
      firstError,
      latestSnapshotUpdatedAt,
    };
    if (shellSummariesEqual(previousSummary, next)) {
      return previousSummary;
    }
    previousSummary = next;
    return previousSummary;
  }).pipe(Atom.withLabel("environment-shell-summary"));
}

export function createEnvironmentServerConfigsAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
}) {
  let previousServerConfigs = EMPTY_SERVER_CONFIGS;
  return Atom.make((get) => {
    const next = new Map<EnvironmentId, ServerConfig>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const config = get(input.serverConfigValueAtom(environmentId));
      if (config !== null) {
        next.set(environmentId, config);
      }
    }
    if (mapsEqual(previousServerConfigs, next)) {
      return previousServerConfigs;
    }
    previousServerConfigs = next;
    return previousServerConfigs;
  }).pipe(Atom.withLabel("environment-server-configs"));
}

export function createEnvironmentShellAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ShellSnapshotLoader | R,
    E
  >,
) {
  const stateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(shellStateChanges(environmentId), {
      initialValue: EMPTY_SHELL_STATE,
    }),
  );

  const stateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(stateAtom(environmentId))), () => EMPTY_SHELL_STATE),
    ).pipe(Atom.withLabel(`environment-shell-state-value:${environmentId}`)),
  );

  return {
    stateAtom,
    stateValueAtom,
  };
}

export * from "./models.ts";
export * from "./shellCommands.ts";
export * from "./shellReducer.ts";
export * from "./shellSnapshotHttp.ts";
export * from "./snapshots.ts";
