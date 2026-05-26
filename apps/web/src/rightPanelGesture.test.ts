import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __registerRightPanelForTests,
  __resetRightPanelGestureStateForTests,
  markRightPanelUsed,
  openLastUsedRightPanel,
} from "./rightPanelGesture";

describe("rightPanelGesture", () => {
  afterEach(() => {
    __resetRightPanelGestureStateForTests();
  });

  it("opens the file panel on the initial right-panel open gesture", () => {
    const openFile = vi.fn();
    const openDiff = vi.fn();

    __registerRightPanelForTests("file", { open: openFile });
    __registerRightPanelForTests("diff", { open: openDiff });

    expect(openLastUsedRightPanel()).toBe(true);
    expect(openFile).toHaveBeenCalledOnce();
    expect(openDiff).not.toHaveBeenCalled();
  });

  it("reopens diff after explicit diff use", () => {
    const openFile = vi.fn();
    const openDiff = vi.fn();

    __registerRightPanelForTests("file", { open: openFile });
    __registerRightPanelForTests("diff", { open: openDiff });
    markRightPanelUsed("diff");

    expect(openLastUsedRightPanel()).toBe(true);
    expect(openDiff).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
  });
});
