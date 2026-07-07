import Constants from "expo-constants";
import { View } from "react-native";

import { AppText as Text } from "./AppText";

type AppVariant = "development" | "preview" | "production";

function resolveAppVariant(): AppVariant {
  const variant = Constants.expoConfig?.extra?.appVariant;
  if (variant === "development" || variant === "preview" || variant === "production") {
    return variant;
  }
  return "production";
}

const VARIANT_COPY: Record<
  Exclude<AppVariant, "production">,
  { readonly label: string; readonly detail: string }
> = {
  development: {
    label: "Development build",
    detail: "This install connects through the Expo dev client and may differ from production.",
  },
  preview: {
    label: "Preview build",
    detail: "This install is a pre-release preview and may differ from the App Store build.",
  },
};

export function BuildVariantBanner() {
  const variant = resolveAppVariant();
  if (variant === "production") {
    return null;
  }

  const copy = VARIANT_COPY[variant];

  return (
    <View
      accessibilityRole="text"
      className="border-b border-border-subtle bg-card px-4 py-2.5"
      testID={`build-variant-banner-${variant}`}
    >
      <Text className="text-center text-xs font-t3-bold uppercase tracking-wide text-foreground">
        {copy.label}
      </Text>
      <Text className="mt-0.5 text-center text-xs leading-normal text-foreground-muted">
        {copy.detail}
      </Text>
    </View>
  );
}
