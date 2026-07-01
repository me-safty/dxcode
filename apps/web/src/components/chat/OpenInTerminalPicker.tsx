import {
  EXTERNAL_TERMINALS,
  type EnvironmentId,
  type ExternalTerminalId,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { usePreferredTerminal } from "~/terminalPreferences";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  AlacrittyIcon,
  GhosttyIcon,
  GnomeTerminalIcon,
  ITermIcon,
  KittyIcon,
  KonsoleIcon,
  TerminalAppIcon,
  WarpIcon,
  WezTermIcon,
  WindowsTerminalIcon,
  type Icon,
} from "../Icons";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const TERMINAL_ICONS = {
  "terminal-app": TerminalAppIcon,
  iterm: ITermIcon,
  ghostty: GhosttyIcon,
  warp: WarpIcon,
  wezterm: WezTermIcon,
  alacritty: AlacrittyIcon,
  kitty: KittyIcon,
  "windows-terminal": WindowsTerminalIcon,
  "gnome-terminal": GnomeTerminalIcon,
  konsole: KonsoleIcon,
} as const satisfies Record<ExternalTerminalId, Icon>;

const resolveOptions = (availableTerminals: ReadonlyArray<ExternalTerminalId>) => {
  const availableTerminalSet = new Set(availableTerminals);
  return EXTERNAL_TERMINALS.filter((terminal) => availableTerminalSet.has(terminal.id)).map(
    (terminal) => ({
      ...terminal,
      Icon: TERMINAL_ICONS[terminal.id],
    }),
  );
};

export const OpenInTerminalPicker = memo(function OpenInTerminalPicker({
  environmentId,
  availableTerminals,
  openInCwd,
  compact = false,
}: {
  environmentId: EnvironmentId;
  availableTerminals: ReadonlyArray<ExternalTerminalId>;
  openInCwd: string | null;
  compact?: boolean;
}) {
  const openInTerminalMutation = useAtomCommand(shellEnvironment.openInTerminal, "open terminal");
  const [preferredTerminal, setPreferredTerminal] = usePreferredTerminal(availableTerminals);
  const options = useMemo(() => resolveOptions(availableTerminals), [availableTerminals]);
  const primaryOption = options.find(({ id }) => id === preferredTerminal) ?? null;
  const PrimaryIcon = primaryOption?.Icon ?? TerminalAppIcon;

  const openInTerminal = useCallback(
    (terminalId: ExternalTerminalId | null) => {
      if (!openInCwd) return;
      const terminal = terminalId ?? preferredTerminal;
      if (!terminal) return;
      const result = openInTerminalMutation({
        environmentId,
        input: {
          cwd: openInCwd,
          terminal,
        },
      });
      setPreferredTerminal(terminal);
      return result;
    },
    [environmentId, openInCwd, openInTerminalMutation, preferredTerminal, setPreferredTerminal],
  );

  return (
    <Group aria-label="Open in terminal">
      <Button
        aria-label="Open folder in preferred terminal"
        size="icon-xs"
        variant="outline"
        disabled={!preferredTerminal || !openInCwd}
        onClick={() => openInTerminal(preferredTerminal)}
      >
        <PrimaryIcon aria-hidden="true" className="size-3.5" />
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={compact ? "Choose terminal" : "Choose terminal"}
              size="icon-xs"
              variant="outline"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 && <MenuItem disabled>No installed terminals found</MenuItem>}
          {options.map(({ label, id, Icon }) => (
            <MenuItem key={id} onClick={() => openInTerminal(id)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
