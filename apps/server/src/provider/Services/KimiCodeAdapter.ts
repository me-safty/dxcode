/**
 * KimiCodeAdapter — shape type for the Kimi Code provider adapter.
 *
 * The driver model bundles one adapter per instance as a captured closure, so
 * this module only retains the shape interface as a naming anchor.
 *
 * @module KimiCodeAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * KimiCodeAdapterShape — per-instance Kimi Code adapter contract.
 */
export interface KimiCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
