import { describe, expect, it } from "vitest";

import {
  canTransitionSandboxLifecycle,
  isActiveSandboxStatus,
  isTerminalSandboxStatus,
  transitionSandboxLifecycle,
} from "./Lifecycle.ts";

describe("Sandbox lifecycle helpers", () => {
  it("classifies active and terminal statuses", () => {
    expect(isActiveSandboxStatus("provisioning")).toBe(true);
    expect(isTerminalSandboxStatus("archived")).toBe(true);
    expect(isActiveSandboxStatus("archived")).toBe(false);
  });

  it("allows expected lifecycle transitions", () => {
    expect(canTransitionSandboxLifecycle("requested", "provisioning")).toBe(true);
    expect(transitionSandboxLifecycle("running", "idle")).toBe("idle");
  });

  it("rejects transitions away from terminal states", () => {
    expect(canTransitionSandboxLifecycle("terminated", "running")).toBe(false);
    expect(() => transitionSandboxLifecycle("archived", "running")).toThrow(
      "Invalid Sandbox lifecycle transition",
    );
  });
});
