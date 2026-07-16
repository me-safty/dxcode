import { SHOWCASE_SCENES, type ShowcaseScene } from "./mobile-showcase-environment.ts";

export { SHOWCASE_SCENES };
export type { ShowcaseScene };

export interface ShowcaseIosDevice {
  readonly id: string;
  readonly platform: "ios";
  /** Exact name from `xcrun simctl list devices available`. */
  readonly simulator: string;
  readonly appearance: "light" | "dark";
  readonly scenes: ReadonlyArray<ShowcaseScene>;
}

export interface ShowcaseAndroidDevice {
  readonly id: string;
  readonly platform: "android";
  /** Exact name from `emulator -list-avds`. */
  readonly avd: string;
  readonly appearance: "light" | "dark";
  /** Native ABI used by the AVD, from its config.ini `abi.type`. */
  readonly abi?: "arm64-v8a" | "x86_64" | "x86" | "armeabi-v7a";
  readonly scenes: ReadonlyArray<ShowcaseScene>;
  /** Optional capture viewport. Omit to use the AVD's native size and density. */
  readonly viewport?: {
    readonly width: number;
    readonly height: number;
    readonly density?: number;
  };
}

export type ShowcaseDevice = ShowcaseIosDevice | ShowcaseAndroidDevice;

export interface ShowcaseConfig {
  readonly outputDirectory: string;
  readonly metroPort: number;
  readonly settleDelayMs: number;
  readonly devices: ReadonlyArray<ShowcaseDevice>;
}

const ANDROID_ABIS = ["arm64-v8a", "x86_64", "x86", "armeabi-v7a"] as const;

export function resolveShowcaseAndroidAbi(
  value: string | undefined,
): NonNullable<ShowcaseAndroidDevice["abi"]> {
  if (!value) return "arm64-v8a";
  if (ANDROID_ABIS.some((abi) => abi === value)) {
    return value as NonNullable<ShowcaseAndroidDevice["abi"]>;
  }
  throw new Error(
    `Unsupported T3_SHOWCASE_ANDROID_ABI '${value}'. Use ${ANDROID_ABIS.join(", ")}.`,
  );
}

/**
 * The defaults cover the current large iPhone, 13-inch iPad, and a flagship
 * Pixel AVD. Edit this matrix (or pass --device / --scene) without changing
 * the runner. Simulator and AVD names are intentionally explicit so captures
 * never silently move to a different screen class after an SDK update.
 */
const config: ShowcaseConfig = {
  outputDirectory: "artifacts/app-store/screenshots",
  // Dedicated port so the harness cannot attach to a normal mobile dev server
  // (or a second worktree) and capture the wrong bundle.
  metroPort: 8199,
  settleDelayMs: 2_500,
  devices: [
    {
      id: "iphone-6.9",
      platform: "ios",
      simulator: "iPhone 17 Pro Max",
      appearance: "dark",
      scenes: ["thread", "terminal", "review", "threads", "environments"],
    },
    {
      id: "ipad-13",
      platform: "ios",
      simulator: "iPad Pro 13-inch (M5)",
      appearance: "dark",
      scenes: ["thread", "terminal", "review", "threads", "environments"],
    },
    {
      id: "pixel",
      platform: "android",
      avd: "Pixel_10_Pro",
      // Apple Silicon uses ARM64 locally; CI overrides this with x86_64 so its
      // Blacksmith Linux runner can use KVM acceleration.
      abi: resolveShowcaseAndroidAbi(process.env.T3_SHOWCASE_ANDROID_ABI),
      appearance: "dark",
      viewport: {
        width: 1280,
        height: 2856,
        density: 480,
      },
      scenes: ["thread", "terminal", "review", "threads", "environments"],
    },
    {
      id: "android-tablet",
      platform: "android",
      avd: "Pixel_10_Pro",
      abi: "arm64-v8a",
      appearance: "dark",
      viewport: {
        width: 1600,
        height: 2560,
        density: 320,
      },
      scenes: ["thread", "terminal", "review", "threads", "environments"],
    },
  ],
};

export default config;
