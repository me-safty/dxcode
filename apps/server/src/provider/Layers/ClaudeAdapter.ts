// @ts-nocheck
import { Layer } from "effect";

import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import {
  ClaudeAcpProviderConfig,
  type AcpAdapterLiveOptions as ClaudeAdapterLiveOptions,
  makeAcpProviderAdapterLayer,
} from "./AcpAdapter.ts";

export type { ClaudeAdapterLiveOptions };

export const ClaudeAdapterLive: Layer.Layer<ClaudeAdapter> = Layer.effect(
  ClaudeAdapter,
  makeAcpProviderAdapterLayer(ClaudeAcpProviderConfig) as any,
);

export function makeClaudeAdapterLive(
  options?: ClaudeAdapterLiveOptions,
): Layer.Layer<ClaudeAdapter> {
  return Layer.effect(
    ClaudeAdapter,
    makeAcpProviderAdapterLayer(ClaudeAcpProviderConfig, options) as any,
  );
}
