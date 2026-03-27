/**
 * ProviderHealth - Provider readiness snapshot service.
 *
 * Owns provider health checks (install/auth reachability) and exposes the
 * latest results to transport layers.
 *
 * @module ProviderHealth
 */
import type { ServerProviderStatus } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderHealthShape {
  /**
   * Read the latest provider health statuses.
   */
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
  /**
   * Re-run all provider health checks and return fresh results.
   */
  readonly refreshStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
  /**
   * Trigger a login flow for the specified provider.
   * Returns success/failure with an optional message.
   */
  readonly login: (provider: "codex" | "claudeAgent") => Effect.Effect<{ success: boolean; message?: string }>;
}

export class ProviderHealth extends ServiceMap.Service<ProviderHealth, ProviderHealthShape>()(
  "t3/provider/Services/ProviderHealth",
) {}
