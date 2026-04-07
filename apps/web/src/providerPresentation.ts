import { type ProviderKind } from "@t3tools/contracts";
import { type ProviderPickerKind } from "./session-logic";
import { type Icon, ClaudeAI, CursorIcon, OpenAI } from "./components/Icons";

export const PROVIDER_ICON_BY_KIND: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
};

export function providerDisplayLabel(provider: ProviderKind): string {
  return provider === "claudeAgent" ? "Claude" : "Codex";
}

export function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}
