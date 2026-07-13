import type { RelayAgentAwarenessPreferences } from "@t3tools/contracts/relay";
import { RelayAgentAwarenessPreferences as RelayAgentAwarenessPreferencesSchema } from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodePreferences = Schema.decodeUnknownOption(
  Schema.fromJsonString(RelayAgentAwarenessPreferencesSchema),
);

export function parseAgentAwarenessPreferences(
  value: string,
): RelayAgentAwarenessPreferences | null {
  return Option.getOrNull(decodePreferences(value));
}

export function alertAllowedForPhase(
  preferences: RelayAgentAwarenessPreferences | null,
  phase: string,
): boolean {
  if (preferences === null) return true;
  switch (phase) {
    case "waiting_for_approval":
      return preferences.notifyOnApproval;
    case "waiting_for_input":
      return preferences.notifyOnInput;
    case "completed":
      return preferences.notifyOnCompletion;
    case "failed":
      return preferences.notifyOnFailure;
    default:
      return false;
  }
}
