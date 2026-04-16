import { type ComponentPropsWithoutRef } from "react";

import { isElectron } from "../env";
import { cn } from "~/lib/utils";

type AppSurfaceHeaderProps = ComponentPropsWithoutRef<"header"> & {
  compact?: boolean;
  reserveTitleBarControlInset?: boolean;
};

export function AppSurfaceHeader({
  children,
  className,
  compact = false,
  reserveTitleBarControlInset = false,
  ...props
}: AppSurfaceHeaderProps) {
  return (
    <header
      className={cn(
        "relative z-10 bg-app-surface after:pointer-events-none after:absolute after:inset-x-0 after:top-[calc(100%-1px)] after:z-0 after:h-6 after:bg-linear-to-b after:from-app-surface after:from-35% after:to-transparent after:content-[''] [&>*]:relative [&>*]:z-10",
        isElectron
          ? cn(
              "drag-region flex h-[52px] items-center px-3 sm:px-5 wco:h-[env(titlebar-area-height)]",
              reserveTitleBarControlInset &&
                "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            )
          : compact
            ? "px-3 py-2 sm:px-5"
            : "px-3 py-2 sm:px-5 sm:py-3",
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}
