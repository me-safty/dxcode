import { MinusIcon, SquareIcon, XIcon } from "lucide-react";

import { windowControlsLayout } from "../env";
import { cn } from "~/lib/utils";

import { Button } from "./ui/button";

function LinuxWindowControlButton(props: { action: "minimize" | "maximize" | "close" }) {
  const bridge = window.desktopBridge;

  const onClick = async () => {
    switch (props.action) {
      case "minimize":
        await bridge?.minimizeWindow?.();
        return;
      case "maximize":
        await bridge?.toggleMaximizeWindow?.();
        return;
      case "close":
        await bridge?.closeWindow?.();
        return;
    }
  };

  return (
    <Button
      aria-label={props.action}
      className={cn(
        "[-webkit-app-region:no-drag] text-muted-foreground/80 hover:text-foreground",
        props.action === "close" && "hover:bg-destructive/16 hover:text-destructive-foreground",
      )}
      size="icon-xs"
      variant="ghost"
      onClick={() => {
        void onClick();
      }}
    >
      {props.action === "minimize" ? (
        <MinusIcon className="size-3.5" />
      ) : props.action === "maximize" ? (
        <SquareIcon className="size-3" />
      ) : (
        <XIcon className="size-3.5" />
      )}
    </Button>
  );
}

function LinuxWindowControlBank(props: {
  actions: readonly ("minimize" | "maximize" | "close")[];
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1",
        props.align === "right" && "justify-end",
      )}
    >
      {props.actions.map((action) => (
        <LinuxWindowControlButton key={action} action={action} />
      ))}
    </div>
  );
}

export function LinuxWindowControls() {
  if (!windowControlsLayout) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <LinuxWindowControlBank actions={windowControlsLayout.left} align="left" />
      <LinuxWindowControlBank actions={windowControlsLayout.right} align="right" />
    </div>
  );
}
