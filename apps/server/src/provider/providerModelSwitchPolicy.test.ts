import { describe, expect, it } from "vite-plus/test";

import {
  resolveProviderModelChangeAction,
  shouldPreserveActiveModelWhenSelectionIsOmitted,
} from "./providerModelSwitchPolicy.ts";

describe("providerModelSwitchPolicy", () => {
  it("derives model-change behavior from the adapter capability", () => {
    expect(
      resolveProviderModelChangeAction({ modelChanged: true, sessionModelSwitch: "in-session" }),
    ).toBe("keep-session");
    expect(
      resolveProviderModelChangeAction({ modelChanged: true, sessionModelSwitch: "new-thread" }),
    ).toBe("require-new-thread");
    expect(
      resolveProviderModelChangeAction({ modelChanged: true, sessionModelSwitch: "unsupported" }),
    ).toBe("restart-session");
    expect(
      resolveProviderModelChangeAction({ modelChanged: false, sessionModelSwitch: "new-thread" }),
    ).toBe("keep-session");
  });

  it("preserves the active model when an adapter cannot switch in-session", () => {
    expect(shouldPreserveActiveModelWhenSelectionIsOmitted("in-session")).toBe(false);
    expect(shouldPreserveActiveModelWhenSelectionIsOmitted("new-thread")).toBe(true);
    expect(shouldPreserveActiveModelWhenSelectionIsOmitted("unsupported")).toBe(true);
  });
});
