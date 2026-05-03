import { describe, expect, it } from "vitest";

import {
  classifySandboxFailureKind,
  isRetryableSandboxFailureKind,
  makeSandboxError,
} from "./Errors.ts";

describe("Sandbox errors", () => {
  it("classifies retryable failure kinds", () => {
    expect(isRetryableSandboxFailureKind("provider_unavailable")).toBe(true);
    expect(isRetryableSandboxFailureKind("auth_failed")).toBe(false);
  });

  it("builds stable tagged errors", () => {
    const error = makeSandboxError({
      kind: "timeout",
      operation: "materialize",
      message: "Timed out",
    });

    expect(error._tag).toBe("SandboxError");
    expect(error.retryable).toBe(true);
  });

  it("normalizes common provider error messages", () => {
    expect(classifySandboxFailureKind(new Error("capacity quota exceeded"))).toBe(
      "capacity_exhausted",
    );
    expect(classifySandboxFailureKind(new Error("invalid resource request"))).toBe(
      "invalid_request",
    );
  });
});
