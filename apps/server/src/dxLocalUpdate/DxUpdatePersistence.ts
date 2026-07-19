import { DxLocalUpdateState, DxUpdatePlan, DxUpdateSession } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";

export const PersistedDxUpdateDocument = Schema.Struct({
  version: Schema.Literal(1),
  state: DxLocalUpdateState,
  plan: Schema.NullOr(DxUpdatePlan),
  session: Schema.NullOr(DxUpdateSession),
});
export type PersistedDxUpdateDocument = typeof PersistedDxUpdateDocument.Type;

export const EMPTY_DX_UPDATE_DOCUMENT: PersistedDxUpdateDocument = {
  version: 1,
  state: { status: "disabled", reason: "Local DX updates require a packaged DX Code build." },
  plan: null,
  session: null,
};

export class DxUpdatePersistenceError extends Data.TaggedError("DxUpdatePersistenceError")<{
  readonly message: string;
}> {}

export class DxUpdatePersistence extends Context.Service<
  DxUpdatePersistence,
  {
    readonly load: Effect.Effect<PersistedDxUpdateDocument>;
    readonly save: (
      document: PersistedDxUpdateDocument,
    ) => Effect.Effect<void, DxUpdatePersistenceError>;
  }
>()("t3/dxLocalUpdate/DxUpdatePersistence") {}

const decodeDocument = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedDxUpdateDocument));
const encodeDocument = Schema.encodeEffect(Schema.fromJsonString(PersistedDxUpdateDocument));

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const statePath = path.join(config.stateDir, "dx-local-update.json");

  const load = fs.exists(statePath).pipe(
    Effect.flatMap((exists) =>
      exists
        ? fs.readFileString(statePath).pipe(Effect.flatMap((raw) => decodeDocument(raw.trim())))
        : Effect.succeed(EMPTY_DX_UPDATE_DOCUMENT),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Could not load local DX update state; using defaults.").pipe(
        Effect.annotateLogs({ statePath, cause }),
        Effect.as(EMPTY_DX_UPDATE_DOCUMENT),
      ),
    ),
  );

  const save = (document: PersistedDxUpdateDocument) =>
    Effect.gen(function* () {
      const encoded = yield* encodeDocument(document);
      yield* writeFileStringAtomically({ filePath: statePath, contents: `${encoded}\n` }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    }).pipe(
      Effect.mapError(
        () => new DxUpdatePersistenceError({ message: "Could not persist local DX update state." }),
      ),
    );

  return DxUpdatePersistence.of({ load, save });
});

export const layer = Layer.effect(DxUpdatePersistence, make);
