import {
  DEFAULT_UPSTREAM_POLICY,
  UpstreamNotificationCursor,
  UpstreamSyncSession,
  UpstreamUpdateState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";

export const PersistedUpstreamSyncDocument = Schema.Struct({
  version: Schema.Literal(1),
  cursor: UpstreamNotificationCursor,
  state: UpstreamUpdateState,
  activeSession: Schema.NullOr(UpstreamSyncSession),
  remoteTagObjects: Schema.Record(Schema.String, Schema.String),
});
export type PersistedUpstreamSyncDocument = typeof PersistedUpstreamSyncDocument.Type;

export const EMPTY_UPSTREAM_SYNC_DOCUMENT: PersistedUpstreamSyncDocument = {
  version: 1,
  cursor: {
    policy: DEFAULT_UPSTREAM_POLICY,
    dismissedTarget: null,
    paused: false,
    activeSessionId: null,
  },
  state: { status: "disabled", reason: "Choose a DX source checkout in Settings." },
  activeSession: null,
  remoteTagObjects: {},
};

export class UpstreamSyncPersistenceError extends Error {
  readonly operation: "read" | "decode" | "write";

  constructor(operation: "read" | "decode" | "write") {
    super(`Could not ${operation} upstream synchronization state.`);
    this.name = "UpstreamSyncPersistenceError";
    this.operation = operation;
  }
}

export class UpstreamSyncPersistence extends Context.Service<
  UpstreamSyncPersistence,
  {
    readonly load: Effect.Effect<PersistedUpstreamSyncDocument, never>;
    readonly save: (
      document: PersistedUpstreamSyncDocument,
    ) => Effect.Effect<void, UpstreamSyncPersistenceError>;
  }
>()("t3/upstreamSync/UpstreamSyncPersistence") {}

const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersistedUpstreamSyncDocument),
);
const encodeDocument = Schema.encodeEffect(Schema.fromJsonString(PersistedUpstreamSyncDocument));

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const statePath = path.join(config.stateDir, "upstream-sync.json");

  const load = fs.exists(statePath).pipe(
    Effect.flatMap((exists) =>
      exists
        ? fs.readFileString(statePath).pipe(Effect.flatMap((raw) => decodeDocument(raw.trim())))
        : Effect.succeed(EMPTY_UPSTREAM_SYNC_DOCUMENT),
    ),
    Effect.matchEffect({
      onFailure: (cause) =>
        Effect.logWarning("Could not load upstream synchronization state; using defaults.").pipe(
          Effect.annotateLogs({ statePath, cause }),
          Effect.as(EMPTY_UPSTREAM_SYNC_DOCUMENT),
        ),
      onSuccess: Effect.succeed,
    }),
  );

  const save = (document: PersistedUpstreamSyncDocument) =>
    Effect.gen(function* () {
      const encoded = yield* encodeDocument(document);
      yield* writeFileStringAtomically({
        filePath: statePath,
        contents: `${encoded}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    }).pipe(Effect.mapError(() => new UpstreamSyncPersistenceError("write")));

  return UpstreamSyncPersistence.of({ load, save });
});

export const layer = Layer.effect(UpstreamSyncPersistence, make);
