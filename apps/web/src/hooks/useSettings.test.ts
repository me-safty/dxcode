import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@t3tools/contracts/settings";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });

  it("migrates the terminal font family from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        terminalFontFamily: '  "MesloLGS NF", monospace  ',
      }),
    ).toEqual({
      terminalFontFamily: '"MesloLGS NF", monospace',
    });
  });

  it("falls back to the default terminal font when the legacy value is blank", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        terminalFontFamily: "",
      }),
    ).toEqual({
      terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    });
  });
});
