import { describe, expect, it } from "vite-plus/test";

import { shouldCloseRightPanelTabOnAuxClick } from "./RightPanelTabs.logic";

describe("shouldCloseRightPanelTabOnAuxClick", () => {
  it("closes right panel tabs only for middle mouse clicks", () => {
    expect(shouldCloseRightPanelTabOnAuxClick(0)).toBe(false);
    expect(shouldCloseRightPanelTabOnAuxClick(1)).toBe(true);
    expect(shouldCloseRightPanelTabOnAuxClick(2)).toBe(false);
  });
});
