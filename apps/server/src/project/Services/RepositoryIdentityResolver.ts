import type { ExecutionTarget, RepositoryIdentity } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface RepositoryIdentityResolveInput {
  readonly cwd: string;
  readonly executionTarget?: ExecutionTarget | undefined;
}

export interface RepositoryIdentityResolverShape {
  readonly resolve: (
    input: string | RepositoryIdentityResolveInput,
  ) => Effect.Effect<RepositoryIdentity | null>;
}

export class RepositoryIdentityResolver extends Context.Service<
  RepositoryIdentityResolver,
  RepositoryIdentityResolverShape
>()("t3/project/Services/RepositoryIdentityResolver") {}
