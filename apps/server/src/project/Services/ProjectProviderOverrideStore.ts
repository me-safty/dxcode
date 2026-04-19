import type { ProjectProviderOverride } from "@t3tools/contracts";
import { Context, Effect, Layer, Ref } from "effect";

export interface ProjectProviderOverrideStoreShape {
  readonly get: (cwd: string) => Effect.Effect<ProjectProviderOverride | undefined>;
  readonly set: (
    cwd: string,
    override: ProjectProviderOverride,
  ) => Effect.Effect<ProjectProviderOverride>;
}

export class ProjectProviderOverrideStore extends Context.Service<
  ProjectProviderOverrideStore,
  ProjectProviderOverrideStoreShape
>()("t3/project/ProjectProviderOverrideStore") {
  static readonly layerTest = (initial: ReadonlyMap<string, ProjectProviderOverride> = new Map()) =>
    Layer.effect(
      ProjectProviderOverrideStore,
      Effect.gen(function* () {
        const ref = yield* Ref.make<Map<string, ProjectProviderOverride>>(new Map(initial));
        return {
          get: (cwd) => Ref.get(ref).pipe(Effect.map((map) => map.get(cwd))),
          set: (cwd, override) =>
            Ref.update(ref, (map) => {
              const next = new Map(map);
              if (override.provider === undefined && override.claudeProfileId === undefined) {
                next.delete(cwd);
              } else {
                next.set(cwd, override);
              }
              return next;
            }).pipe(Effect.as(override)),
        } satisfies ProjectProviderOverrideStoreShape;
      }),
    );
}
