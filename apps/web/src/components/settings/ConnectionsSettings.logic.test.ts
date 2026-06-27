import type { DesktopWslState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { applyWslEnableSelection } from "./ConnectionsSettings.logic";

const baseWslState: DesktopWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears a persisted WSL-only preference when enabling both backends", async () => {
    let persistedWslOnly = true;
    const setWslDistro = vi.fn(async () => baseWslState);
    const setWslBackendEnabled = vi.fn(async () => ({ ...baseWslState, enabled: true }));
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      persistedWslOnly = enabled;
      return { ...baseWslState, enabled: true, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: null,
      persistedDistro: null,
    });

    expect(setWslDistro).not.toHaveBeenCalled();
    expect(setWslBackendEnabled).toHaveBeenCalledWith(true);
    expect(setWslOnly).toHaveBeenCalledWith(false);
    expect(persistedWslOnly).toBe(false);
    expect(state.wslOnly).toBe(false);
  });
});
