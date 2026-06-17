import { Maximize2Icon, Minimize2Icon, PanelBottomIcon, PanelRightIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  placement?: "titlebar" | "panel-header";
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  rightPanelMaximized: boolean;
  canMaximizeRightPanel: boolean;
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
  onToggleRightPanelMaximized: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  placement = "titlebar",
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  rightPanelMaximized,
  canMaximizeRightPanel,
  onToggleTerminal,
  onToggleRightPanel,
  onToggleRightPanelMaximized,
}: PanelLayoutControlsProps) {
  return (
    <div
      className={cn(
        "z-50 flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]",
        placement === "titlebar" ? "workspace-titlebar-controls" : "h-full",
      )}
      data-panel-layout-controls
    >
      {rightPanelOpen && canMaximizeRightPanel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0 [-webkit-app-region:no-drag]"
                pressed={rightPanelMaximized}
                onPressedChange={onToggleRightPanelMaximized}
                aria-label={rightPanelMaximized ? "Restore panel size" : "Maximize panel"}
                variant="ghost"
                size="sm"
              >
                {rightPanelMaximized ? (
                  <Minimize2Icon className="size-3.5" />
                ) : (
                  <Maximize2Icon className="size-3.5" />
                )}
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {rightPanelMaximized ? "Restore panel size" : "Maximize panel"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={terminalOpen}
              onPressedChange={onToggleTerminal}
              aria-label="Toggle terminal drawer"
              variant="ghost"
              size="sm"
              disabled={!terminalAvailable}
            >
              <PanelBottomIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {terminalAvailable
            ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
            : "Terminal drawer is unavailable"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={rightPanelOpen}
              onPressedChange={onToggleRightPanel}
              aria-label="Toggle right panel"
              variant="ghost"
              size="sm"
              disabled={!rightPanelAvailable}
            >
              <PanelRightIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {rightPanelAvailable
            ? `Toggle right panel${rightPanelShortcutLabel ? ` (${rightPanelShortcutLabel})` : ""}`
            : "Right panel is unavailable"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
