import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { useThemeColor } from "../../../../lib/useThemeColor";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export function FontSizeControlRow(props: {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly label: string;
  readonly valueLabel: string;
  readonly canDecrease: boolean;
  readonly canIncrease: boolean;
  readonly onDecrease: () => void;
  readonly onIncrease: () => void;
}) {
  const icon = useThemeColor("--color-icon");
  const buttonBackground = String(useThemeColor("--color-secondary"));
  const buttonForeground = String(useThemeColor("--color-foreground"));

  return (
    <View
      className="flex-row items-center gap-4 p-4"
      style={{ opacity: props.disabled ? 0.45 : 1 }}
    >
      <SymbolView name={props.icon} size={22} tintColor={icon} type="monochrome" weight="regular" />
      <Text className="flex-1 text-lg text-foreground">{props.label}</Text>
      <View className="flex-row items-center gap-2">
        <FontSizeStepButton
          accessibilityLabel={`Decrease ${props.label}`}
          backgroundColor={buttonBackground}
          disabled={props.disabled || !props.canDecrease}
          foregroundColor={buttonForeground}
          label="−"
          onPress={props.onDecrease}
        />
        <Text className="min-w-[52px] text-center text-base font-t3-medium text-foreground-muted">
          {props.valueLabel}
        </Text>
        <FontSizeStepButton
          accessibilityLabel={`Increase ${props.label}`}
          backgroundColor={buttonBackground}
          disabled={props.disabled || !props.canIncrease}
          foregroundColor={buttonForeground}
          label="+"
          onPress={props.onIncrease}
        />
      </View>
    </View>
  );
}

function FontSizeStepButton(props: {
  readonly accessibilityLabel: string;
  readonly backgroundColor: string;
  readonly disabled: boolean;
  readonly foregroundColor: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className="h-8 w-8 items-center justify-center rounded-full"
      style={{
        backgroundColor: props.backgroundColor,
        opacity: props.disabled ? 0.35 : 1,
      }}
    >
      <Text className="text-lg font-t3-medium" style={{ color: props.foregroundColor }}>
        {props.label}
      </Text>
    </Pressable>
  );
}
