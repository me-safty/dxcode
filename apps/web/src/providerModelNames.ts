import {
  ProviderDriverKind,
  type ProviderDriverKind as ProviderDriverKindType,
} from "@t3tools/contracts";
import { formatGeminiModelDisplayName } from "@t3tools/shared/gemini";

export function formatAppModelOptionName(
  provider: ProviderDriverKindType | string,
  model: string | null | undefined,
): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return "";
  }

  const driver = typeof provider === "string" ? ProviderDriverKind.make(provider) : provider;
  switch (driver) {
    case "gemini":
      return formatGeminiModelDisplayName(trimmed);
    default:
      return trimmed;
  }
}
