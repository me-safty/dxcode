import * as Layer from "effect/Layer";

import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { LaunchEnvLive } from "../Services/LaunchEnv.ts";

export const makeLaunchEnvLayerLive = <E, R>(persistenceLayer: Layer.Layer<never, E, R>) =>
  LaunchEnvLive.pipe(
    Layer.provide(
      OrchestrationProjectionSnapshotQueryLive.pipe(
        Layer.provide(persistenceLayer),
        Layer.provide(RepositoryIdentityResolverLive),
      ),
    ),
  );
