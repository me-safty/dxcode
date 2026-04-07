import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface GlmBridgeShape {
  readonly baseUrl: Effect.Effect<string>;
}

export class GlmBridgeService extends ServiceMap.Service<GlmBridgeService, GlmBridgeShape>()(
  "t3/provider/glmBridge/GlmBridgeService",
) {}
