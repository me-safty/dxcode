import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useCallback, useMemo } from "react";
import { shortcutLabelForCommand } from "../../keybindings";
import { usePreferredTerminal } from "../../terminalPreferences";
import { ChevronDownIcon, SquareTerminalIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import type { Icon } from "../Icons";
import {
  AlacrittyIcon,
  AppleTerminalIcon,
  CommandPromptIcon,
  GenericTerminalIcon,
  GhosttyIcon,
  GnomeTerminalIcon,
  HyperIcon,
  ITermIcon,
  KittyIcon,
  KonsoleIcon,
  PowerShellIcon,
  WarpIcon,
  WezTermIcon,
  WindowsTerminalIcon,
} from "../TerminalIcons";
import { readLocalApi } from "~/localApi";

type TerminalDisplay = { readonly label: string; readonly Icon: Icon };

const TERMINAL_DISPLAY: Record<string, TerminalDisplay> = {
  Ghostty: { label: "Ghostty", Icon: GhosttyIcon },
  iTerm: { label: "iTerm", Icon: ITermIcon },
  WezTerm: { label: "WezTerm", Icon: WezTermIcon },
  wezterm: { label: "WezTerm", Icon: WezTermIcon },
  Alacritty: { label: "Alacritty", Icon: AlacrittyIcon },
  alacritty: { label: "Alacritty", Icon: AlacrittyIcon },
  kitty: { label: "kitty", Icon: KittyIcon },
  Warp: { label: "Warp", Icon: WarpIcon },
  Hyper: { label: "Hyper", Icon: HyperIcon },
  Terminal: { label: "Terminal", Icon: AppleTerminalIcon },
  "gnome-terminal": { label: "GNOME Terminal", Icon: GnomeTerminalIcon },
  konsole: { label: "Konsole", Icon: KonsoleIcon },
  "xfce4-terminal": { label: "Xfce Terminal", Icon: GenericTerminalIcon },
  "x-terminal-emulator": { label: "Default Terminal", Icon: GenericTerminalIcon },
  xterm: { label: "XTerm", Icon: GenericTerminalIcon },
  "wt.exe": { label: "Windows Terminal", Icon: WindowsTerminalIcon },
  "pwsh.exe": { label: "PowerShell", Icon: PowerShellIcon },
  "powershell.exe": { label: "Windows PowerShell", Icon: PowerShellIcon },
  "cmd.exe": { label: "Command Prompt", Icon: CommandPromptIcon },
};

function displayForTerminal(exec: string): TerminalDisplay {
  return TERMINAL_DISPLAY[exec] ?? { label: exec, Icon: GenericTerminalIcon };
}

export const OpenInTerminalPicker = memo(function OpenInTerminalPicker({
  keybindings,
  availableTerminals,
  openInCwd,
  compact = false,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableTerminals: ReadonlyArray<string>;
  openInCwd: string | null;
  compact?: boolean;
}) {
  const [preferredTerminal, setPreferredTerminal] = usePreferredTerminal(availableTerminals);
  const options = useMemo(
    () => availableTerminals.map((exec) => ({ exec, ...displayForTerminal(exec) })),
    [availableTerminals],
  );
  const primaryOption = options.find(({ exec }) => exec === preferredTerminal) ?? null;
  const PrimaryIcon = primaryOption?.Icon ?? SquareTerminalIcon;

  const openInTerminal = useCallback(
    (exec: string | null) => {
      const api = readLocalApi();
      if (!api || !openInCwd) return;
      const terminal = exec ?? preferredTerminal;
      if (!terminal) return;
      void api.shell.openInTerminal(openInCwd, terminal);
      setPreferredTerminal(terminal);
    },
    [preferredTerminal, openInCwd, setPreferredTerminal],
  );

  const openExternalTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.openExternal"),
    [keybindings],
  );

  return (
    <Group aria-label="Open in terminal">
      <Button
        aria-label={compact ? "Open in preferred terminal" : undefined}
        size="xs"
        variant="outline"
        disabled={!preferredTerminal || !openInCwd}
        onClick={() => openInTerminal(preferredTerminal)}
      >
        <PrimaryIcon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Open in terminal</span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={
            <Button aria-label="Choose terminal" size="icon-xs" variant="outline" />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 && <MenuItem disabled>No installed terminals found</MenuItem>}
          {options.map(({ exec, label, Icon }) => (
            <MenuItem key={exec} onClick={() => openInTerminal(exec)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
              {exec === preferredTerminal && openExternalTerminalShortcutLabel && (
                <MenuShortcut>{openExternalTerminalShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
