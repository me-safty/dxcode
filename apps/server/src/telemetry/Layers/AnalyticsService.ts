import { Effect, Layer } from "effect";

import { AnalyticsService } from "../Services/AnalyticsService.ts";

export const AnalyticsServiceNoopLive = Layer.succeed(AnalyticsService, {
  record: () => Effect.void,
  flush: Effect.void,
});
