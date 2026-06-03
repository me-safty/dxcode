"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full items-center py-1.5">
        <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb className="size-4 rounded-full border border-primary bg-background shadow-sm outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-dragging:ring-2 data-dragging:ring-ring data-disabled:cursor-not-allowed data-disabled:opacity-64" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
