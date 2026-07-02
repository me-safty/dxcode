import { useCallback } from "react";

import {
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  stepCodeFontSize,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { FontSizeControlRow } from "../components/FontSizeControlRow";

export function CodeAppearanceSection() {
  const { isReady, appearance, setCodeFontSize, setCodeWordBreak } = useAppearancePreferences();
  const custom = appearance.isCodeFontSizeCustom;

  const handleToggleCustom = useCallback(
    (enabled: boolean) => {
      setCodeFontSize(enabled ? appearance.codeFontSize : null);
    },
    [appearance.codeFontSize, setCodeFontSize],
  );

  const handleDecrease = useCallback(() => {
    setCodeFontSize(stepCodeFontSize(appearance.codeFontSize, -1));
  }, [appearance.codeFontSize, setCodeFontSize]);

  const handleIncrease = useCallback(() => {
    setCodeFontSize(stepCodeFontSize(appearance.codeFontSize, 1));
  }, [appearance.codeFontSize, setCodeFontSize]);

  return (
    <SettingsSection title="Code & Diffs">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="chevron.left.forwardslash.chevron.right"
        label="Custom font size"
        onValueChange={handleToggleCustom}
        value={custom}
      />
      <FontSizeControlRow
        canDecrease={appearance.codeFontSize > MIN_CODE_FONT_SIZE}
        canIncrease={appearance.codeFontSize < MAX_CODE_FONT_SIZE}
        disabled={!isReady || !custom}
        icon="textformat.size"
        label="Font size"
        onDecrease={handleDecrease}
        onIncrease={handleIncrease}
        valueLabel={`${appearance.codeFontSize} pt`}
      />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="text.word.spacing"
        label="Word break"
        onValueChange={setCodeWordBreak}
        value={appearance.codeWordBreak}
      />
    </SettingsSection>
  );
}
