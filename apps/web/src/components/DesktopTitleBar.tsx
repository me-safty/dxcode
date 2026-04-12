import type { ReactNode } from "react";

import { isWindowsElectron } from "~/env";
import { cn } from "~/lib/utils";

import { DesktopWindowControls } from "./DesktopWindowControls";

interface DesktopTitleBarProps {
  title: string;
  subtitle?: string;
  contextLabel?: string;
  contextValue?: string;
  showContextChip?: boolean;
  trailing?: ReactNode;
  className?: string;
  showWindowControls?: boolean;
  titleViewportPaddingClassName?: string;
  titleAlignment?: "center" | "left";
  useNativeWindowControlsOverlay?: boolean;
  reserveNativeWindowControlsOverlay?: boolean;
}

export function DesktopTitleBar(props: DesktopTitleBarProps) {
  const showContextChip = props.showContextChip ?? true;
  const contextLabel = props.contextLabel ?? "Workspace";
  const contextValue = props.contextValue;
  const titleAlignment = props.titleAlignment ?? "center";
  const useNativeWindowControlsOverlay = props.useNativeWindowControlsOverlay ?? isWindowsElectron;
  const reserveNativeWindowControlsOverlay =
    props.reserveNativeWindowControlsOverlay ??
    (useNativeWindowControlsOverlay && props.showWindowControls !== false);

  return (
    <div
      className={cn(
        isWindowsElectron
          ? "drag-region relative flex h-[var(--desktop-titlebar-height)] shrink-0 items-center border-b-0 bg-white ps-4 pe-0 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:border-b after:border-border/70 dark:bg-[#0e1218]"
          : "drag-region relative flex h-[44px] shrink-0 items-center border-b border-border/70 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_95%,var(--color-black)_5%)_0%,var(--background)_65%,color-mix(in_srgb,var(--background)_94%,var(--color-black)_6%)_100%)] ps-3 pe-0",
        props.className,
      )}
    >
      {showContextChip ? (
        <div className="min-w-0 max-w-[40%] truncate">
          <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/70 px-2 py-1 text-[11px] leading-none">
            <span className="inline-flex size-4 items-center justify-center rounded-sm bg-foreground text-[9px] font-semibold text-background">
              T3
            </span>
            <span className="truncate font-medium tracking-tight text-foreground/85">
              {contextLabel}
            </span>
            {contextValue ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
                {contextValue}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {titleAlignment === "center" ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex min-w-0 items-center justify-center px-[8.5rem]",
            props.titleViewportPaddingClassName,
          )}
        >
          <div className="min-w-0 text-center">
            <div className="truncate text-[12px] font-medium text-foreground/90">{props.title}</div>
            {props.subtitle ? (
              <div className="truncate text-[10px] text-muted-foreground/85">{props.subtitle}</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1 pe-4 desktop-windows:pe-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-col desktop-windows:flex-row desktop-windows:items-center desktop-windows:gap-2">
              <div className="truncate text-[12px] font-medium tracking-tight text-foreground/92">
                {props.title}
              </div>
              {props.subtitle ? (
                <div className="truncate text-[10px] text-muted-foreground/85 desktop-windows:text-[11px]">
                  {props.subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="ms-auto flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {props.trailing ? (
          <div
            className={cn(
              "flex h-full items-center gap-1",
              reserveNativeWindowControlsOverlay ? "me-3 desktop-windows:me-2" : "pe-3",
            )}
          >
            {props.trailing}
          </div>
        ) : null}
        {props.showWindowControls === false ? null : reserveNativeWindowControlsOverlay ? (
          <div aria-hidden="true" className="pointer-events-none h-full w-[138px] shrink-0" />
        ) : useNativeWindowControlsOverlay ? null : (
          <DesktopWindowControls className="self-stretch" />
        )}
      </div>
    </div>
  );
}
