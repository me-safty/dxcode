import { type ClaudeCodeEffort } from "@t3tools/contracts";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

const EFFORT_LABELS: Record<ClaudeCodeEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

const DEFAULT_EFFORT: ClaudeCodeEffort = "high";

export const ClaudeCodeTraitsPicker = memo(function ClaudeCodeTraitsPicker(props: {
  effort: ClaudeCodeEffort;
  thinkingEnabled: boolean;
  onEffortChange: (effort: ClaudeCodeEffort) => void;
  onThinkingChange: (enabled: boolean) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerLabel = [
    EFFORT_LABELS[props.effort],
    ...(props.thinkingEnabled ? [] : ["No Thinking"]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
          />
        }
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Effort</div>
          <MenuRadioGroup
            value={props.effort}
            onValueChange={(value) => {
              if (!value) return;
              props.onEffortChange(value as ClaudeCodeEffort);
            }}
          >
            <MenuRadioItem value="low">{EFFORT_LABELS.low}</MenuRadioItem>
            <MenuRadioItem value="medium">{EFFORT_LABELS.medium}</MenuRadioItem>
            <MenuRadioItem value="high">
              {EFFORT_LABELS.high}
              {" (default)"}
            </MenuRadioItem>
            <MenuRadioItem value="max">{EFFORT_LABELS.max}</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuDivider />
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
            Extended Thinking
          </div>
          <MenuRadioGroup
            value={props.thinkingEnabled ? "on" : "off"}
            onValueChange={(value) => {
              props.onThinkingChange(value === "on");
            }}
          >
            <MenuRadioItem value="off">off</MenuRadioItem>
            <MenuRadioItem value="on">on (default)</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});
