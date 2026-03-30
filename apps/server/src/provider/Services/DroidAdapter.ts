/**
 * DroidAdapter - Droid/ACP implementation of the generic provider adapter contract.
 *
 * This service owns ACP protocol semantics (JSON-RPC 2.0 over stdio) and emits
 * canonical provider runtime events. It does not perform cross-provider routing,
 * shared event fan-out, or checkpoint orchestration.
 *
 * @module DroidAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface DroidAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "droid";
}

export class DroidAdapter extends ServiceMap.Service<DroidAdapter, DroidAdapterShape>()(
  "t3/provider/Services/DroidAdapter",
) {}
