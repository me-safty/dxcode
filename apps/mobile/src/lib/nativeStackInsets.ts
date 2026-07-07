import { Platform } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";

import {
  nativeStackBottomScrollInset as nativeStackBottomScrollInsetModel,
  nativeStackScrollIndicatorTopInset as nativeStackScrollIndicatorTopInsetModel,
  nativeStackTopScrollInset as nativeStackTopScrollInsetModel,
  usesNativeStackAutomaticScrollInsets as usesNativeStackAutomaticScrollInsetsModel,
  type NativeStackPlatform,
} from "./nativeStackInsetsModel";

export {
  ANDROID_NATIVE_STACK_HEADER_HEIGHT,
  IOS_NATIVE_STACK_HEADER_HEIGHT,
  type NativeStackPlatform,
} from "./nativeStackInsetsModel";

export function usesNativeStackAutomaticScrollInsets(
  platform: NativeStackPlatform = Platform.OS,
): boolean {
  return usesNativeStackAutomaticScrollInsetsModel(platform);
}

export function nativeStackTopScrollInset(
  insets: EdgeInsets,
  options?: {
    readonly extra?: number;
    readonly includeHeader?: boolean;
    readonly platform?: NativeStackPlatform;
  },
): number {
  return nativeStackTopScrollInsetModel(insets, options?.platform ?? Platform.OS, options);
}

export function nativeStackScrollIndicatorTopInset(
  insets: EdgeInsets,
  includeHeader = true,
  platform: NativeStackPlatform = Platform.OS,
): number {
  return nativeStackScrollIndicatorTopInsetModel(insets, platform, includeHeader);
}

export function nativeStackBottomScrollInset(insets: EdgeInsets, minimum = 24): number {
  return nativeStackBottomScrollInsetModel(insets, minimum);
}
