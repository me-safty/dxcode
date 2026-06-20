import type { ProviderSessionModelSwitchMode } from "./Services/ProviderAdapter.ts";

export type ProviderModelChangeAction = "keep-session" | "require-new-thread" | "restart-session";

export function resolveProviderModelChangeAction(input: {
  readonly modelChanged: boolean;
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
}): ProviderModelChangeAction {
  if (!input.modelChanged || input.sessionModelSwitch === "in-session") {
    return "keep-session";
  }
  return input.sessionModelSwitch === "new-thread" ? "require-new-thread" : "restart-session";
}

export function shouldPreserveActiveModelWhenSelectionIsOmitted(
  sessionModelSwitch: ProviderSessionModelSwitchMode,
): boolean {
  return sessionModelSwitch !== "in-session";
}
