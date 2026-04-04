// @ts-nocheck
import { Layer } from "effect";

import { CodexAdapter } from "../Services/CodexAdapter.ts";
import {
  CodexAcpProviderConfig,
  type AcpAdapterLiveOptions as CodexAdapterLiveOptions,
  makeAcpProviderAdapterLayer,
} from "./AcpAdapter.ts";

export type { CodexAdapterLiveOptions };

export const CodexAdapterLive: Layer.Layer<CodexAdapter> = Layer.effect(
  CodexAdapter,
  makeAcpProviderAdapterLayer(CodexAcpProviderConfig) as any,
);

export function makeCodexAdapterLive(options?: CodexAdapterLiveOptions): Layer.Layer<CodexAdapter> {
  return Layer.effect(
    CodexAdapter,
    makeAcpProviderAdapterLayer(CodexAcpProviderConfig, options) as any,
  );
}
