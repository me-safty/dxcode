import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { getNewThreadRuntimeMode } from "./newThreadSettings";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getNewThreadRuntimeMode", () => {
  it("returns the server-configured default runtime mode", () => {
    expect(
      getNewThreadRuntimeMode({
        ...DEFAULT_SERVER_SETTINGS,
        defaultRuntimeMode: "approval-required",
      }),
    ).toBe("approval-required");
  });

  it("blocks thread creation until server settings are available", () => {
    const addToast = vi.spyOn(toastManager, "add").mockImplementation(() => "toast-1");

    expect(getNewThreadRuntimeMode(null)).toBeNull();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not create thread" }),
    );
  });
});
