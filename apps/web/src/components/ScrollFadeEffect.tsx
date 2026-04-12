import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";

import { cn } from "~/lib/utils";

export type ScrollFadeEffectProps = ComponentPropsWithoutRef<"div"> & {
  orientation?: "horizontal" | "vertical";
};

export const ScrollFadeEffect = forwardRef<HTMLDivElement, ScrollFadeEffectProps>(
  ({ className, orientation = "vertical", ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-orientation={orientation}
        className={cn(
          "data-[orientation=horizontal]:overflow-x-auto data-[orientation=horizontal]:overflow-y-hidden",
          "data-[orientation=vertical]:overflow-y-auto data-[orientation=vertical]:overflow-x-hidden",
          "data-[orientation=horizontal]:scroll-fade-effect-x data-[orientation=vertical]:scroll-fade-effect-y",
          className,
        )}
        {...props}
      />
    );
  },
);

ScrollFadeEffect.displayName = "ScrollFadeEffect";
