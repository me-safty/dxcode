import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_KEYBINDINGS, parseKeybindingShortcut } from "./keybindings.ts";

describe("voice.toggleRecording keybinding", () => {
  it("has a default alt+v binding", () => {
    const rule = DEFAULT_KEYBINDINGS.find((r) => r.command === "voice.toggleRecording");
    expect(rule?.key).toBe("alt+v");
  });
  it("parses alt+v as the Alt modifier + v", () => {
    const shortcut = parseKeybindingShortcut("alt+v");
    expect(shortcut).toMatchObject({ key: "v", altKey: true, ctrlKey: false, metaKey: false });
  });
});
