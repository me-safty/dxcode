import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { BotIcon, ListTodoIcon, LockIcon, LockOpenIcon, PenLineIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

const runtimeModeIcon = {
  "approval-required": LockIcon,
  "auto-accept-edits": PenLineIcon,
  "full-access": LockOpenIcon,
} satisfies Record<RuntimeMode, typeof LockIcon>;

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {props.traitsMenuContent}
      {props.showInteractionModeToggle ? (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
          type="button"
          onClick={props.onToggleInteractionMode}
          title={props.interactionMode === "plan" ? "Plan mode" : "Research mode"}
        >
          <BotIcon className="size-4" />
          <span className="sr-only">{props.interactionMode === "plan" ? "Plan" : "Research"}</span>
        </Button>
      ) : null}
      {(["approval-required", "auto-accept-edits", "full-access"] as const).map((mode) => {
        const ModeIcon = runtimeModeIcon[mode];
        return (
          <Button
            key={mode}
            size="sm"
            variant="ghost"
            className={cn(
              "shrink-0 px-2",
              props.runtimeMode === mode
                ? "text-foreground"
                : "text-muted-foreground/60 hover:text-foreground/80",
            )}
            type="button"
            onClick={() => props.onRuntimeModeChange(mode)}
            aria-label={`Set access mode to ${mode}`}
          >
            <ModeIcon className="size-4" />
          </Button>
        );
      })}
      {props.activePlan ? (
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "shrink-0 px-2",
            props.planSidebarOpen
              ? "text-blue-400 hover:text-blue-300"
              : "text-muted-foreground/70 hover:text-foreground/80",
          )}
          type="button"
          onClick={props.onTogglePlanSidebar}
          aria-label={`${props.planSidebarOpen ? "Hide" : "Show"} ${props.planSidebarLabel}`}
        >
          <ListTodoIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
});
