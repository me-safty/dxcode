/**
 * FactoryDroidAdapter - Factory Droid implementation of the generic provider adapter contract.
 *
 * This service wraps the `droid` CLI behind the shared provider adapter
 * contract and emits canonical provider runtime events.
 *
 * @module FactoryDroidAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface FactoryDroidAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "factoryDroid";
}

export class FactoryDroidAdapter extends ServiceMap.Service<
  FactoryDroidAdapter,
  FactoryDroidAdapterShape
>()("t3/provider/Services/FactoryDroidAdapter") {}
