/**
 * GrokBuildAdapter — Grok Build CLI via shared ACP provider adapter.
 *
 * @module GrokBuildAdapter
 */

import { type GrokBuildSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { applyGrokAcpModelSelection, makeGrokAcpRuntime } from "../acp/GrokAcpSupport.ts";
import {
  makeAcpProviderAdapter,
  type AcpProviderAdapterLiveOptions,
} from "./AcpProviderAdapter.ts";
import { resolveCursorAcpBaseModelId as resolveGrokBuildAcpBaseModelId } from "./CursorProvider.ts";

const PROVIDER = ProviderDriverKind.make("grokBuild");
const GROK_BUILD_RESUME_VERSION = 1 as const;

export type GrokBuildAdapterLiveOptions = AcpProviderAdapterLiveOptions<GrokBuildSettings>;

export function makeGrokBuildAdapter(
  grokBuildSettings: GrokBuildSettings,
  options?: GrokBuildAdapterLiveOptions,
) {
  return makeAcpProviderAdapter<GrokBuildSettings>(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("grokBuild"),
      displayName: "Grok Build",
      resumeSchemaVersion: GROK_BUILD_RESUME_VERSION,
      settings: grokBuildSettings,
      cursorExtensionSupport: true,
      makeRuntime: ({ settings, environment, requestLogger, protocolLogging, ...input }) =>
        makeGrokAcpRuntime({
          grokBuildSettings: settings,
          ...input,
          ...(environment ? { environment } : {}),
          ...(requestLogger ? { requestLogger } : {}),
          ...(protocolLogging ? { protocolLogging } : {}),
        }),
      applyModelSelection: applyGrokAcpModelSelection,
      resolveBaseModelId: resolveGrokBuildAcpBaseModelId,
    },
    options,
  );
}
