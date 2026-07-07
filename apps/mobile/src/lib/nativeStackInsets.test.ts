import { describe, expect, it } from "vite-plus/test";

import {
  ANDROID_NATIVE_STACK_HEADER_HEIGHT,
  IOS_NATIVE_STACK_HEADER_HEIGHT,
  nativeStackBottomScrollInset,
  nativeStackScrollIndicatorTopInset,
  nativeStackTopScrollInset,
  usesNativeStackAutomaticScrollInsets,
} from "./nativeStackInsetsModel";

const insets = { top: 30, right: 0, bottom: 20, left: 0 };

describe("nativeStackTopScrollInset", () => {
  it("includes the iOS navigation bar under the status bar", () => {
    expect(nativeStackTopScrollInset(insets, "ios", { extra: 8, includeHeader: true })).toBe(
      insets.top + IOS_NATIVE_STACK_HEADER_HEIGHT + 8,
    );
  });

  it("includes the Android toolbar under the status bar", () => {
    expect(nativeStackTopScrollInset(insets, "android", { extra: 8, includeHeader: true })).toBe(
      insets.top + ANDROID_NATIVE_STACK_HEADER_HEIGHT + 8,
    );
  });

  it("can omit the navigation header when a screen renders its own chrome", () => {
    expect(nativeStackTopScrollInset(insets, "android", { extra: 8, includeHeader: false })).toBe(
      insets.top + 8,
    );
  });
});

describe("nativeStackScrollIndicatorTopInset", () => {
  it("tracks the navigation header height on Android", () => {
    expect(nativeStackScrollIndicatorTopInset(insets, "android")).toBe(
      insets.top + ANDROID_NATIVE_STACK_HEADER_HEIGHT,
    );
  });
});

describe("usesNativeStackAutomaticScrollInsets", () => {
  it("is enabled only on iOS", () => {
    expect(usesNativeStackAutomaticScrollInsets("ios")).toBe(true);
    expect(usesNativeStackAutomaticScrollInsets("android")).toBe(false);
  });
});

describe("nativeStackBottomScrollInset", () => {
  it("respects the larger of the home-indicator inset and the minimum padding", () => {
    expect(nativeStackBottomScrollInset(insets, 24)).toBe(24);
    expect(nativeStackBottomScrollInset({ ...insets, bottom: 32 }, 24)).toBe(32);
  });
});
