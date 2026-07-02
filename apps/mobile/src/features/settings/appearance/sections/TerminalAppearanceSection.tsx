import { useCallback } from "react";

import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  stepTerminalFontSize,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { FontSizeControlRow } from "../components/FontSizeControlRow";

export function TerminalAppearanceSection() {
  const { isReady, appearance, setTerminalFontSize } = useAppearancePreferences();
  const custom = appearance.isTerminalFontSizeCustom;

  const handleToggleCustom = useCallback(
    (enabled: boolean) => {
      setTerminalFontSize(enabled ? appearance.terminalFontSize : null);
    },
    [appearance.terminalFontSize, setTerminalFontSize],
  );

  const handleDecrease = useCallback(() => {
    setTerminalFontSize(stepTerminalFontSize(appearance.terminalFontSize, -1));
  }, [appearance.terminalFontSize, setTerminalFontSize]);

  const handleIncrease = useCallback(() => {
    setTerminalFontSize(stepTerminalFontSize(appearance.terminalFontSize, 1));
  }, [appearance.terminalFontSize, setTerminalFontSize]);

  return (
    <SettingsSection title="Terminal">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="terminal"
        label="Custom font size"
        onValueChange={handleToggleCustom}
        value={custom}
      />
      <FontSizeControlRow
        canDecrease={appearance.terminalFontSize > MIN_TERMINAL_FONT_SIZE}
        canIncrease={appearance.terminalFontSize < MAX_TERMINAL_FONT_SIZE}
        disabled={!isReady || !custom}
        icon="textformat.size"
        label="Font size"
        onDecrease={handleDecrease}
        onIncrease={handleIncrease}
        valueLabel={`${appearance.terminalFontSize.toFixed(1)} pt`}
      />
    </SettingsSection>
  );
}
