/**
 * OpenCodeAdapter - OpenCode coding agent provider adapter contract.
 *
 * This service wraps the OpenCode CLI/server as a coding agent provider,
 * communicating via the OpenCode HTTP API with SSE event streaming.
 *
 * @module OpenCodeAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * OpenCodeAdapterShape - Service API for the OpenCode provider adapter.
 */
export interface OpenCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "opencode";
}

/**
 * OpenCodeAdapter - Service tag for OpenCode provider adapter operations.
 */
export class OpenCodeAdapter extends ServiceMap.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "t3/provider/Services/OpenCodeAdapter",
) {}
