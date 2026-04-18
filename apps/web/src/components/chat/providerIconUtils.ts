import { type ProviderKind, PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { ClaudeAI, CursorIcon, Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { PROVIDER_OPTIONS } from "../../session-logic";

export const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
};

export function providerIconClassName(provider: ProviderKind, fallbackClassName: string): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

function isAvailableProviderOption(
  option: (typeof PROVIDER_OPTIONS)[number],
): option is { value: ProviderKind; label: string; available: true } {
  return option.available;
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);

/**
 * Get the display label for a provider, handling special cases like OpenCode.
 * For OpenCode models with format "SubProvider · Model Name", extracts "SubProvider".
 * Otherwise returns the standard provider display name.
 */
export function getProviderLabel(provider: ProviderKind, modelName: string): string {
  // For OpenCode, extract the sub-provider from the model name (format: "SubProvider · Model Name")
  if (provider === "opencode") {
    const parts = modelName.split(" · ");
    if (parts.length > 1) {
      return parts[0]!.trim();
    }
  }

  return PROVIDER_DISPLAY_NAMES[provider];
}

/**
 * Get the display name for a model, removing provider prefix for OpenCode.
 * For OpenCode models with format "SubProvider · Model Name", extracts "Model Name".
 * For other providers, returns the model name as-is.
 */
export function getDisplayModelName(provider: ProviderKind, modelName: string): string {
  // For OpenCode, extract just the model name part (format: "SubProvider · Model Name")
  if (provider === "opencode") {
    const parts = modelName.split(" · ");
    if (parts.length > 1) {
      return parts[1]!.trim();
    }
  }

  return modelName;
}
