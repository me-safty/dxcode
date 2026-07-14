export type AppVariant = "development" | "preview" | "production";

export interface AppVariantAssets {
  readonly appIcon: string;
  readonly iosIcon: string;
  readonly splashIcon: string;
  readonly androidAdaptiveForeground: string;
  readonly androidAdaptiveBackgroundColor: string;
  readonly androidMonochromeIcon: string;
  readonly androidNotificationIcon: string;
  readonly androidNotificationColor: string;
}

export interface AppVariantConfig {
  readonly appName: string;
  readonly scheme: string;
  readonly iosBundleIdentifier: string;
  readonly androidPackage: string;
  readonly relyingParty?: string;
  readonly assets: AppVariantAssets;
}

const DEVELOPMENT_ASSETS = {
  appIcon: "./assets/splash-icon-dev.png",
  iosIcon: "./assets/icon-composer-dev.icon",
  splashIcon: "./assets/splash-icon-dev.png",
  androidAdaptiveForeground: "./assets/android-icon-dev-foreground.png",
  androidAdaptiveBackgroundColor: "#00639B",
  androidMonochromeIcon: "./assets/android-icon-mark.png",
  androidNotificationIcon: "./assets/android-notification-icon.png",
  androidNotificationColor: "#00639B",
} as const satisfies AppVariantAssets;

const RELEASE_ASSETS = {
  appIcon: "./assets/splash-icon-prod.png",
  iosIcon: "./assets/icon-composer-prod.icon",
  splashIcon: "./assets/splash-icon-prod.png",
  androidAdaptiveForeground: "./assets/android-icon-mark.png",
  androidAdaptiveBackgroundColor: "#000000",
  androidMonochromeIcon: "./assets/android-icon-mark.png",
  androidNotificationIcon: "./assets/android-notification-icon.png",
  androidNotificationColor: "#FFFFFF",
} as const satisfies AppVariantAssets;

export const APP_VARIANT_CONFIG = {
  development: {
    appName: "T3 Code Dev",
    scheme: "t3code-dev",
    iosBundleIdentifier: "com.t3tools.t3code.dev",
    androidPackage: "com.t3tools.t3code.dev",
    relyingParty: "clerk.t3.codes",
    assets: DEVELOPMENT_ASSETS,
  },
  preview: {
    appName: "T3 Code Preview",
    scheme: "t3code-preview",
    iosBundleIdentifier: "com.t3tools.t3code.preview",
    androidPackage: "com.t3tools.t3code.preview",
    relyingParty: "clerk.t3.codes",
    assets: RELEASE_ASSETS,
  },
  production: {
    appName: "T3 Code",
    scheme: "t3code",
    iosBundleIdentifier: "com.t3tools.t3code",
    androidPackage: "com.t3tools.t3code",
    relyingParty: "clerk.t3.codes",
    assets: RELEASE_ASSETS,
  },
} as const satisfies Record<AppVariant, AppVariantConfig>;

export function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}
