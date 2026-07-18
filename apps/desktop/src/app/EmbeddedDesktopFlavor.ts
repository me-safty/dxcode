import {
  isDesktopPackagedFlavorId,
  type DesktopPackagedFlavorId,
} from "@t3tools/shared/desktopFlavor";

declare const __T3CODE_DESKTOP_FLAVOR__: string | undefined;

const embeddedValue =
  typeof __T3CODE_DESKTOP_FLAVOR__ === "undefined"
    ? "production"
    : __T3CODE_DESKTOP_FLAVOR__.trim();

if (!isDesktopPackagedFlavorId(embeddedValue)) {
  throw new Error(`Invalid embedded desktop flavor: ${embeddedValue}`);
}

export const embeddedDesktopFlavorId: DesktopPackagedFlavorId = embeddedValue;
