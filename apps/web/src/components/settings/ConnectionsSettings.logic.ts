import type { DesktopBridge, DesktopWslState } from "@t3tools/contracts";

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  await bridge.setWslBackendEnabled(true);

  // Persist both choices explicitly so a stale WSL-only preference cannot
  // override the mode selected in the enable dialog after relaunch.
  return await bridge.setWslOnly(mode === "wsl-only");
}
