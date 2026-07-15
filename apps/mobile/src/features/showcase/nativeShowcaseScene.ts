import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { SHOWCASE_SCENES, type ShowcaseScene } from "./showcaseData";

interface NativeShowcaseControls {
  readonly getShowcaseScene?: () => string | null;
  readonly markShowcaseReady?: (scene: ShowcaseScene) => void;
}

function nativeShowcaseControls(): NativeShowcaseControls | null {
  return requireOptionalNativeModule<NativeShowcaseControls>("T3NativeControls");
}

export function getNativeShowcaseScene(): ShowcaseScene {
  if (Platform.OS !== "ios") return "thread";

  try {
    const value = nativeShowcaseControls()?.getShowcaseScene?.();
    return SHOWCASE_SCENES.find((scene) => scene === value) ?? "thread";
  } catch {
    return "thread";
  }
}

export function markNativeShowcaseReady(scene: ShowcaseScene): void {
  if (Platform.OS !== "ios") return;

  try {
    nativeShowcaseControls()?.markShowcaseReady?.(scene);
  } catch {
    // The readiness marker is capture-runner metadata, never app functionality.
  }
}
