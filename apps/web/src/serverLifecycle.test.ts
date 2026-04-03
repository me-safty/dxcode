import { describe, expect, it } from "vitest";

import { shouldReloadForServerInstanceChange } from "./serverLifecycle";

describe("shouldReloadForServerInstanceChange", () => {
  it("does not reload on the first welcome event", () => {
    expect(shouldReloadForServerInstanceChange(null, "server-1")).toBe(false);
  });

  it("does not reload when the welcome event is for the same server instance", () => {
    expect(shouldReloadForServerInstanceChange("server-1", "server-1")).toBe(false);
  });

  it("reloads when a later welcome event comes from a different server instance", () => {
    expect(shouldReloadForServerInstanceChange("server-1", "server-2")).toBe(true);
  });
});
