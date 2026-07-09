import { createContext, useContext } from "react";

import { toastManager } from "../../ui/toast";

/**
 * A host-intent sink. Every Mosaic `on:event` that is not a local `state.*`
 * mutation crosses to the host as a named intent carrying already-computed
 * args. The artifact never acts on its own - the host decides what to do.
 */
export type MosaicIntent = (action: string, args?: unknown) => void;

/** Render intent args compactly for a toast description: `seats: 12, total: 192`. */
function compactArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args !== "object" || Array.isArray(args)) return JSON.stringify(args);
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
}

/**
 * Default sink: surface the intent as a toast so the click visibly does
 * something. A surrounding {@link MosaicIntentProvider} can override this to
 * route intents somewhere richer (e.g. back to the agent as a follow-up turn).
 */
export const defaultMosaicIntent: MosaicIntent = (action, args) => {
  const description = compactArgs(args);
  toastManager.add({
    type: "info",
    title: `Intent · ${action}`,
    ...(description !== undefined ? { description } : {}),
  });
};

const MosaicIntentContext = createContext<MosaicIntent>(defaultMosaicIntent);

/** Override the intent sink for a subtree of the conversation. */
export const MosaicIntentProvider = MosaicIntentContext.Provider;

/** Read the active intent sink; falls back to {@link defaultMosaicIntent}. */
export function useMosaicIntent(): MosaicIntent {
  return useContext(MosaicIntentContext);
}
