import { MinusIcon, PlusIcon } from "lucide-react";
import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Choose how T3 Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Chat font size"
          description="Controls the text size of messages, tool calls, and code in the chat timeline."
          resetAction={
            settings.chatFontSize !== DEFAULT_UNIFIED_SETTINGS.chatFontSize ? (
              <SettingResetButton
                label="chat font size"
                onClick={() =>
                  updateSettings({
                    chatFontSize: DEFAULT_UNIFIED_SETTINGS.chatFontSize,
                  })
                }
              />
            ) : null
          }
          control={
            <div
              className="inline-flex items-center gap-1"
              role="group"
              aria-label="Chat font size"
            >
              <Button
                size="icon-xs"
                variant="outline"
                disabled={settings.chatFontSize <= CHAT_FONT_SIZE_MIN}
                onClick={() =>
                  updateSettings({
                    chatFontSize: Math.max(CHAT_FONT_SIZE_MIN, settings.chatFontSize - 1),
                  })
                }
                aria-label="Decrease chat font size"
              >
                <MinusIcon />
              </Button>
              <span className="inline-flex w-14 items-center justify-center rounded-md border border-input bg-popover px-2 py-1 text-center font-mono text-xs tabular-nums text-foreground">
                {settings.chatFontSize}px
              </span>
              <Button
                size="icon-xs"
                variant="outline"
                disabled={settings.chatFontSize >= CHAT_FONT_SIZE_MAX}
                onClick={() =>
                  updateSettings({
                    chatFontSize: Math.min(CHAT_FONT_SIZE_MAX, settings.chatFontSize + 1),
                  })
                }
                aria-label="Increase chat font size"
              >
                <PlusIcon />
              </Button>
            </div>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
