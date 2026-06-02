import { WorktreeLocationResolverError } from "@t3tools/contracts";
import { Effect, Context, Layer } from "effect";

export interface ResolveCreateWorktreePathInput {
  readonly projectRoot: string;
  readonly name: string;
}

export interface WorktreeLocationResolverShape {
  readonly resolveCreateWorktreePath: (
    input: ResolveCreateWorktreePathInput,
  ) => Effect.Effect<string, WorktreeLocationResolverError>;
}

export class WorktreeLocationResolver extends Context.Service<
  WorktreeLocationResolver,
  WorktreeLocationResolverShape
>()("t3/project/Services/WorktreeLocationResolver") {
  static readonly layerTest = ({
    resolveCreateWorktreePath = (input) =>
      Effect.succeed(
        [input.projectRoot.replace(/\/+$/g, ""), ".mock-worktrees", input.name.replace(/\//g, "-")]
          .filter((segment) => segment.length > 0)
          .join("/"),
      ),
  }: {
    resolveCreateWorktreePath?: WorktreeLocationResolverShape["resolveCreateWorktreePath"];
  } = {}) =>
    Layer.succeed(WorktreeLocationResolver, {
      resolveCreateWorktreePath,
    });
}
