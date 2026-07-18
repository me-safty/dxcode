export const DesktopPackagedFlavorIds = ["production", "dx"] as const;

export type DesktopPackagedFlavorId = (typeof DesktopPackagedFlavorIds)[number];
export type DesktopFlavorId = DesktopPackagedFlavorId | "development";

export interface DesktopFlavor {
  readonly id: DesktopFlavorId;
  readonly appId: string;
  readonly productName: string;
  readonly baseName: string;
  readonly appUserModelId: string;
  readonly userDataDirName: string;
  readonly legacyUserDataDirName: string;
  readonly stateDirName: string;
  readonly rendererScheme: string;
  readonly registeredSchemes: readonly string[];
  readonly artifactPrefix: string;
  readonly executableName: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
  readonly iconBrand: "production" | "development";
  readonly autoUpdatesEnabled: boolean;
  readonly isolateStateRoot: boolean;
}

const DESKTOP_FLAVORS = {
  production: {
    id: "production",
    appId: "com.t3tools.t3code",
    productName: "T3 Code (Alpha)",
    baseName: "T3 Code",
    appUserModelId: "com.t3tools.t3code",
    userDataDirName: "t3code",
    legacyUserDataDirName: "T3 Code (Alpha)",
    stateDirName: "userdata",
    rendererScheme: "t3code",
    registeredSchemes: ["t3code", "t3code-dev"],
    artifactPrefix: "T3-Code",
    executableName: "t3code",
    linuxDesktopEntryName: "t3code.desktop",
    linuxWmClass: "t3code",
    iconBrand: "production",
    autoUpdatesEnabled: true,
    isolateStateRoot: false,
  },
  development: {
    id: "development",
    appId: "com.t3tools.t3code.dev",
    productName: "T3 Code (Dev)",
    baseName: "T3 Code",
    appUserModelId: "com.t3tools.t3code.dev",
    userDataDirName: "t3code-dev",
    legacyUserDataDirName: "T3 Code (Dev)",
    stateDirName: "dev",
    rendererScheme: "t3code-dev",
    registeredSchemes: ["t3code-dev"],
    artifactPrefix: "T3-Code-Dev",
    executableName: "t3code-dev",
    linuxDesktopEntryName: "t3code-dev.desktop",
    linuxWmClass: "t3code-dev",
    iconBrand: "development",
    autoUpdatesEnabled: false,
    isolateStateRoot: true,
  },
  dx: {
    id: "dx",
    appId: "com.t3tools.dxcode",
    productName: "DX Code",
    baseName: "DX Code",
    appUserModelId: "com.t3tools.dxcode",
    userDataDirName: "dxcode",
    legacyUserDataDirName: "DX Code",
    stateDirName: "dx",
    rendererScheme: "dxcode",
    registeredSchemes: ["dxcode"],
    artifactPrefix: "DX-Code",
    executableName: "dxcode",
    linuxDesktopEntryName: "dxcode.desktop",
    linuxWmClass: "dxcode",
    iconBrand: "development",
    autoUpdatesEnabled: false,
    isolateStateRoot: true,
  },
} as const satisfies Record<DesktopFlavorId, DesktopFlavor>;

export function isDesktopPackagedFlavorId(value: string): value is DesktopPackagedFlavorId {
  return (DesktopPackagedFlavorIds as readonly string[]).includes(value);
}

export function resolveDesktopFlavor(id: DesktopFlavorId): DesktopFlavor {
  return DESKTOP_FLAVORS[id];
}

export function resolveDesktopRuntimeFlavor(input: {
  readonly isDevelopment: boolean;
  readonly packagedFlavorId: DesktopPackagedFlavorId;
}): DesktopFlavor {
  return resolveDesktopFlavor(input.isDevelopment ? "development" : input.packagedFlavorId);
}
