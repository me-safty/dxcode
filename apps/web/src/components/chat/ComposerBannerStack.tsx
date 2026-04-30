import type { ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: "error" | "info" | "success" | "warning";
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
  if (items.length === 0) {
    return null;
  }

  const frontItem = items[0];
  if (!frontItem) {
    return null;
  }
  const stackedItems = items.slice(1);
  const hasStack = stackedItems.length > 0;

  return (
    <div className={cn("group/banner-stack mx-auto mb-2 max-w-208", className)}>
      <div
        className={cn(
          "relative",
          hasStack ? "group-hover/banner-stack:z-50 group-focus-within/banner-stack:z-50" : null,
        )}
      >
        {hasStack ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -top-3 z-0 mx-auto h-3 rounded-t-xl",
              "border border-b-0 border-warning/24 bg-background/96 shadow-[0_6px_18px_rgba(0,0,0,0.06)]",
              "transition-opacity duration-150 ease-out",
              "group-hover/banner-stack:opacity-0 group-focus-within/banner-stack:opacity-0",
            )}
            style={{ width: "96%" }}
            aria-hidden="true"
          />
        ) : null}
        <div className="relative z-10">
          <ComposerBannerStackAlert item={frontItem} />
        </div>
        {hasStack ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-20 space-y-2 opacity-0",
              "transition-[opacity,transform] duration-150 ease-out",
              "translate-y-1 transform-gpu will-change-[opacity,transform]",
              "group-hover/banner-stack:pointer-events-auto group-hover/banner-stack:translate-y-0 group-hover/banner-stack:opacity-100",
              "group-focus-within/banner-stack:pointer-events-auto group-focus-within/banner-stack:translate-y-0 group-focus-within/banner-stack:opacity-100",
            )}
          >
            {stackedItems.map((item) => (
              <div key={item.id}>
                <ComposerBannerStackAlert item={item} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerBannerStackAlert({ item }: { readonly item: ComposerBannerStackItem }) {
  return (
    <Alert variant={item.variant}>
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction>
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss warning"}
              onClick={item.onDismiss}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
