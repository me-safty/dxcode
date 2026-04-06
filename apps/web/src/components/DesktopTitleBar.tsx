import type { ReactNode } from "react";

import { APP_BASE_NAME, APP_STAGE_LABEL } from "~/branding";
import { cn } from "~/lib/utils";

import { DesktopWindowControls } from "./DesktopWindowControls";

interface DesktopTitleBarProps {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  className?: string;
  showWindowControls?: boolean;
}

export function DesktopTitleBar(props: DesktopTitleBarProps) {
  return (
    <div
      className={cn(
        "drag-region relative flex h-[44px] shrink-0 items-center border-b border-border/70 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_95%,var(--color-black)_5%)_0%,var(--background)_65%,color-mix(in_srgb,var(--background)_94%,var(--color-black)_6%)_100%)] px-3",
        props.className,
      )}
    >
      <div className="min-w-0 max-w-[40%] truncate">
        <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/70 px-2 py-1 text-[11px] leading-none">
          <span className="inline-flex size-4 items-center justify-center rounded-sm bg-foreground text-[9px] font-semibold text-background">
            T3
          </span>
          <span className="truncate font-medium tracking-tight text-foreground/85">{APP_BASE_NAME}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.16em] uppercase text-muted-foreground">
            {APP_STAGE_LABEL}
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center justify-center px-[8.5rem]">
        <div className="min-w-0 text-center">
          <div className="truncate text-[12px] font-medium text-foreground/90">{props.title}</div>
          {props.subtitle ? (
            <div className="truncate text-[10px] text-muted-foreground/85">{props.subtitle}</div>
          ) : null}
        </div>
      </div>

      <div className="ms-auto flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
        {props.trailing}
        {props.showWindowControls === false ? null : <DesktopWindowControls />}
      </div>
    </div>
  );
}
