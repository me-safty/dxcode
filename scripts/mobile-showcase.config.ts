export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

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
      scenes: ["thread", "terminal", "review", "threads"],
    },
    {
      id: "ipad-13",
      platform: "ios",
      simulator: "iPad Pro 13-inch (M5)",
      appearance: "dark",
      scenes: ["thread", "terminal", "review"],
    },
    {
      id: "pixel",
      platform: "android",
      avd: "Pixel_10_Pro",
      abi: "arm64-v8a",
      appearance: "dark",
      scenes: ["thread", "terminal", "review", "threads"],
    },
  ],
};

export default config;
