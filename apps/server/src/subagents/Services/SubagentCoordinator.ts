import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface SubagentCoordinatorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class SubagentCoordinator extends ServiceMap.Service<
  SubagentCoordinator,
  SubagentCoordinatorShape
>()("t3/subagents/Services/SubagentCoordinator") {}
