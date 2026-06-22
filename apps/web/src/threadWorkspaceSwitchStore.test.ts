import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useThreadWorkspaceSwitchStore } from "./threadWorkspaceSwitchStore";

describe("threadWorkspaceSwitchStore", () => {
  beforeEach(() => {
    useThreadWorkspaceSwitchStore.setState({ switchingThreadKeys: new Set() });
  });

  it("tracks workspace switches independently by thread", () => {
    const store = useThreadWorkspaceSwitchStore.getState();
    store.beginSwitch("environment-1:thread-1");
    store.beginSwitch("environment-1:thread-2");

    expect(useThreadWorkspaceSwitchStore.getState().switchingThreadKeys).toEqual(
      new Set(["environment-1:thread-1", "environment-1:thread-2"]),
    );

    useThreadWorkspaceSwitchStore.getState().endSwitch("environment-1:thread-1");
    expect(useThreadWorkspaceSwitchStore.getState().switchingThreadKeys).toEqual(
      new Set(["environment-1:thread-2"]),
    );
  });
});
