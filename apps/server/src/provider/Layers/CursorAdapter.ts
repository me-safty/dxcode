/**
 * CursorAdapter — Cursor CLI (`agent acp`) via shared ACP provider adapter.
 *
 * @module CursorAdapter
 */

import { type CursorSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { applyCursorAcpModelSelection, makeCursorAcpRuntime } from "../acp/CursorAcpSupport.ts";
import {
  makeAcpProviderAdapter,
  type AcpProviderAdapterLiveOptions,
} from "./AcpProviderAdapter.ts";
import { resolveCursorAcpBaseModelId } from "./CursorProvider.ts";

const PROVIDER = ProviderDriverKind.make("cursor");
const CURSOR_RESUME_VERSION = 1 as const;

export type CursorAdapterLiveOptions = AcpProviderAdapterLiveOptions<CursorSettings>;

export function makeCursorAdapter(
  cursorSettings: CursorSettings,
  options?: CursorAdapterLiveOptions,
) {
  return makeAcpProviderAdapter<CursorSettings>(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("cursor"),
      displayName: "Cursor",
      resumeSchemaVersion: CURSOR_RESUME_VERSION,
      settings: cursorSettings,
      cursorExtensionSupport: true,
      makeRuntime: ({ settings, environment, requestLogger, protocolLogging, ...input }) =>
        makeCursorAcpRuntime({
          cursorSettings: settings,
          ...input,
          ...(environment ? { environment } : {}),
          ...(requestLogger ? { requestLogger } : {}),
          ...(protocolLogging ? { protocolLogging } : {}),
        }),
      applyModelSelection: applyCursorAcpModelSelection,
      resolveBaseModelId: resolveCursorAcpBaseModelId,
    },
    options,
  );
}
