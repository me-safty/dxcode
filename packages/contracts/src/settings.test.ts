import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ClientSettingsSchema,
  DEFAULT_TERMINAL_FONT_FAMILY,
  normalizeTerminalFontFamily,
} from "./settings";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("ClientSettingsSchema", () => {
  it("fills defaults for persisted settings that predate terminal font support", () => {
    expect(
      decodeClientSettings({
        confirmThreadDelete: false,
      }),
    ).toMatchObject({
      confirmThreadArchive: false,
      confirmThreadDelete: false,
      diffWordWrap: false,
      terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    });
  });

  it("normalizes blank terminal font values back to the default stack", () => {
    expect(
      decodeClientSettings({
        terminalFontFamily: "   ",
      }),
    ).toMatchObject({
      terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    });
  });

  it("trims custom terminal font stacks without altering internal separators", () => {
    expect(
      decodeClientSettings({
        terminalFontFamily: '  "MesloLGS NF", "JetBrainsMono Nerd Font", monospace  ',
      }),
    ).toMatchObject({
      terminalFontFamily: '"MesloLGS NF", "JetBrainsMono Nerd Font", monospace',
    });
  });

  it("normalizes standalone terminal font values", () => {
    expect(normalizeTerminalFontFamily("   ")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(normalizeTerminalFontFamily('  "MesloLGS NF", monospace  ')).toBe(
      '"MesloLGS NF", monospace',
    );
  });
});
