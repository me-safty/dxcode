import type { EdgeInsets } from "react-native-safe-area-context";

/** iOS UINavigationBar content height below the status bar. */
export const IOS_NATIVE_STACK_HEADER_HEIGHT = 44;

/** Material toolbar height used by react-native-screens on Android. */
export const ANDROID_NATIVE_STACK_HEADER_HEIGHT = 56;

export type NativeStackPlatform = "ios" | "android" | "web" | "windows" | "macos";

export function usesNativeStackAutomaticScrollInsets(platform: NativeStackPlatform): boolean {
  return platform === "ios";
}

export function nativeStackTopScrollInset(
  insets: EdgeInsets,
  platform: NativeStackPlatform,
  options?: {
    readonly extra?: number;
    readonly includeHeader?: boolean;
  },
): number {
  const extra = options?.extra ?? 0;
  const includeHeader = options?.includeHeader ?? true;
  if (platform === "ios") {
    return includeHeader ? insets.top + IOS_NATIVE_STACK_HEADER_HEIGHT + extra : insets.top + extra;
  }
  if (platform === "android") {
    return includeHeader
      ? insets.top + ANDROID_NATIVE_STACK_HEADER_HEIGHT + extra
      : insets.top + extra;
  }
  return extra;
}

export function nativeStackScrollIndicatorTopInset(
  insets: EdgeInsets,
  platform: NativeStackPlatform,
  includeHeader = true,
): number {
  if (platform === "ios" && includeHeader) {
    return insets.top + IOS_NATIVE_STACK_HEADER_HEIGHT;
  }
  if (platform === "android" && includeHeader) {
    return insets.top + ANDROID_NATIVE_STACK_HEADER_HEIGHT;
  }
  return insets.top;
}

export function nativeStackBottomScrollInset(insets: EdgeInsets, minimum = 24): number {
  return Math.max(insets.bottom, minimum);
}
