import { type CSSProperties, type ElementType, type ReactNode } from "react";

import { cn } from "~/lib/utils";

interface BlurRevealProps<T extends ElementType = "span"> {
  children: ReactNode;
  className?: string;
  delay?: number;
  speedReveal?: number;
  trigger?: boolean;
  as?: T;
  style?: CSSProperties;
}

export function BlurReveal<T extends ElementType = "span">({
  children,
  className,
  delay = 0,
  speedReveal = 0.45,
  trigger = true,
  as,
  style,
}: BlurRevealProps<T>) {
  const Component = as ?? "span";

  return (
    <Component
      className={cn(
        "inline-block will-change-[filter,opacity,transform] motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:blur-none",
        trigger && "animate-[blur-reveal_var(--blur-reveal-duration)_ease-out_both]",
        className,
      )}
      style={
        {
          "--blur-reveal-duration": `${speedReveal}s`,
          animationDelay: `${delay}s`,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}
