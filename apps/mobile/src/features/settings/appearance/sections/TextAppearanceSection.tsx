import { useCallback } from "react";

import {
  MAX_BASE_FONT_SIZE,
  MIN_BASE_FONT_SIZE,
  stepBaseFontSize,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { FontSizeControlRow } from "../components/FontSizeControlRow";

export function TextAppearanceSection() {
  const { isReady, appearance, setBaseFontSize } = useAppearancePreferences();

  const handleDecrease = useCallback(() => {
    setBaseFontSize(stepBaseFontSize(appearance.baseFontSize, -1));
  }, [appearance.baseFontSize, setBaseFontSize]);

  const handleIncrease = useCallback(() => {
    setBaseFontSize(stepBaseFontSize(appearance.baseFontSize, 1));
  }, [appearance.baseFontSize, setBaseFontSize]);

  return (
    <SettingsSection title="Text">
      <FontSizeControlRow
        canDecrease={appearance.baseFontSize > MIN_BASE_FONT_SIZE}
        canIncrease={appearance.baseFontSize < MAX_BASE_FONT_SIZE}
        disabled={!isReady}
        icon="textformat.size"
        label="Base font size"
        onDecrease={handleDecrease}
        onIncrease={handleIncrease}
        valueLabel={`${appearance.baseFontSize} pt`}
      />
    </SettingsSection>
  );
}
