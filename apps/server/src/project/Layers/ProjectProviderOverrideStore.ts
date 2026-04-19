/**
 * ProjectProviderOverrideStore - User-level store pinning absolute repo cwd
 * paths to a preferred Claude profile id.
 *
 * Persisted as a single JSON file under the server state directory (user
 * scope, not shared with the repo). Reads are cached in-process; writes are
 * atomic (temp + rename).
 *
 * @module ProjectProviderOverrideStore
 */
import { ProjectProviderOverride as ProjectProviderOverrideSchema } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import {
  isEmptyProjectProviderOverride,
  ProjectProviderOverrideStore,
} from "../Services/ProjectProviderOverrideStore.ts";

const PersistedFile = Schema.Struct({
  version: Schema.Literal(1),
  overrides: Schema.Record(Schema.String, ProjectProviderOverrideSchema),
});
type PersistedFile = typeof PersistedFile.Type;

const decodePersistedFile = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedFile));

const EMPTY: PersistedFile = { version: 1, overrides: {} };

export const ProjectProviderOverrideStoreLive = Layer.effect(
  ProjectProviderOverrideStore,
  Effect.gen(function* () {
    const { projectProviderOverridesPath } = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const writeSemaphore = yield* Semaphore.make(1);

    const loadFromDisk = Effect.gen(function* () {
      const exists = yield* fs
        .exists(projectProviderOverridesPath)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists) return EMPTY;
      const raw = yield* fs
        .readFileString(projectProviderOverridesPath)
        .pipe(Effect.orElseSucceed(() => ""));
      const trimmed = raw.trim();
      if (trimmed.length === 0) return EMPTY;
      return yield* decodePersistedFile(trimmed).pipe(Effect.orElseSucceed(() => EMPTY));
    });

    const initial = yield* loadFromDisk;
    const stateRef = yield* Ref.make<PersistedFile>(initial);

    const writeAtomically = (next: PersistedFile) =>
      Effect.gen(function* () {
        const tempPath = `${projectProviderOverridesPath}.${process.pid}.${Date.now()}.tmp`;
        yield* fs.makeDirectory(pathService.dirname(projectProviderOverridesPath), {
          recursive: true,
        });
        yield* fs.writeFileString(tempPath, `${JSON.stringify(next, null, 2)}\n`);
        yield* fs
          .rename(tempPath, projectProviderOverridesPath)
          .pipe(
            Effect.ensuring(
              fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true })),
            ),
          );
      }).pipe(Effect.orDie);

    return {
      get: (cwd) =>
        Ref.get(stateRef).pipe(Effect.map((state) => state.overrides[cwd] ?? undefined)),
      set: (cwd, override) =>
        writeSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(stateRef);
            const overrides = { ...current.overrides };
            if (isEmptyProjectProviderOverride(override)) {
              delete overrides[cwd];
            } else {
              overrides[cwd] = override;
            }
            const next: PersistedFile = { version: 1, overrides };
            yield* writeAtomically(next);
            yield* Ref.set(stateRef, next);
            return override;
          }),
        ),
    };
  }),
);
