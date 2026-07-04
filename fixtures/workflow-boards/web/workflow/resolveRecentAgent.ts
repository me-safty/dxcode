import type { AgentSelection } from "../../contracts/workflow.ts";
import { DEFAULT_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import type {
  ProviderInstanceId,
  ServerProvider
} from "@t3tools/contracts";

import {
  deriveProviderInstanceEntries,
  getAppAtomRegistry,
  primaryServerProvidersAtom,
} from "@t3tools/plugin-sdk-web";

type AgentChoice = AgentSelection | null;

export interface RecentAgentSources {
  readonly sticky: AgentChoice;
  readonly recentThread: AgentChoice;
  readonly defaultChoice: AgentChoice;
  readonly isAvailable: (instance: string) => boolean;
}

export function pickRecentAgent(sources: RecentAgentSources): AgentSelection | null {
  for (const candidate of [sources.sticky, sources.recentThread, sources.defaultChoice]) {
    if (candidate && sources.isAvailable(candidate.instance)) {
      return candidate;
    }
  }
  return null;
}

function resolveDefaultAgent(input: {
  readonly entries: ReturnType<typeof deriveProviderInstanceEntries>;
}): AgentChoice {
  const entry = input.entries[0];
  if (!entry) {
    return null;
  }
  const model =
    entry.models.find((candidate) => !candidate.isCustom)?.slug ??
    entry.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[entry.driverKind];
  if (!model) {
    return null;
  }
  return {
    instance: entry.instanceId,
    model,
  };
}

export function resolveRecentAgent(
  providers?: ReadonlyArray<ServerProvider>,
): AgentSelection | null {
  const availableEntries = deriveProviderInstanceEntries(
    providers ?? getAppAtomRegistry().get(primaryServerProvidersAtom) ?? [],
  ).filter((entry) => entry.enabled && entry.installed && entry.isAvailable);
  const availableInstances = new Set<ProviderInstanceId>(
    availableEntries.map((entry) => entry.instanceId),
  );

  // Intentional degradation vs the host: the host resolved `sticky` (the
  // composer's last-used agent) and `recentThread` (the most recent thread's model)
  // from host composer/thread state that the plugin SDK does not expose. Without
  // them we fall back to `defaultChoice` (first available provider/model). The agent
  // pickers still work; they just don't pre-select the user's most-recent agent.
  // If the SDK later exposes the sticky/thread selection, wire it back here.
  return pickRecentAgent({
    sticky: null,
    recentThread: null,
    defaultChoice: resolveDefaultAgent({ entries: availableEntries }),
    isAvailable: (instance) => availableInstances.has(instance as ProviderInstanceId),
  });
}
