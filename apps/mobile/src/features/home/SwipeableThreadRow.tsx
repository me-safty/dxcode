import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";

const ACTION_WIDTH = 80;

const wrapperStyle = { overflow: "hidden" as const };

const actionContainerStyle = {
  position: "absolute" as const,
  right: 0,
  top: 0,
  bottom: 0,
  width: ACTION_WIDTH,
  backgroundColor: "#ef4444",
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const actionButtonStyle = {
  flex: 1,
  width: "100%" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  gap: 4,
};

const actionLabelStyle = { color: "#ffffff", fontSize: 11 };

export function SwipeableThreadRow(props: {
  readonly onArchive: () => void;
  readonly children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const cardBg = useThemeColor("--color-card");

  const triggerArchive = useCallback(() => {
    Haptics.selectionAsync();
    translateX.value = withTiming(0, { duration: 200 });
    props.onArchive();
  }, [props.onArchive, translateX]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          "worklet";
          startX.value = translateX.value;
        })
        .onUpdate((event) => {
          "worklet";
          const next = startX.value + event.translationX;
          translateX.value = Math.min(0, Math.max(-ACTION_WIDTH, next));
        })
        .onEnd((event) => {
          "worklet";
          const shouldOpen =
            translateX.value < -ACTION_WIDTH * 0.4 || event.velocityX < -400;
          if (shouldOpen) {
            translateX.value = withTiming(-ACTION_WIDTH, { duration: 200 });
          } else {
            translateX.value = withTiming(0, { duration: 200 });
          }
        }),
    [startX, translateX],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const actionOpacity = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / (ACTION_WIDTH * 0.5)),
  }));

  return (
    <View style={wrapperStyle}>
      <Animated.View style={[actionContainerStyle, actionOpacity]}>
        <Pressable onPress={triggerArchive} style={actionButtonStyle}>
          <SymbolView name="archivebox.fill" size={20} tintColor="#ffffff" type="monochrome" />
          <Text className="font-t3-bold" style={actionLabelStyle}>
            Archive
          </Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[{ backgroundColor: cardBg }, rowStyle]}>
          {props.children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
