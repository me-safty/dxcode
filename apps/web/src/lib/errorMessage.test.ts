import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "./errorMessage";

describe("extractErrorMessage", () => {
  const fallback = "fallback message";

  it("returns the message of a regular Error", () => {
    const err = new Error("boom");
    expect(extractErrorMessage(err, fallback)).toBe("boom");
  });

  it("returns fallback when Error has empty message", () => {
    const err = new Error("");
    expect(extractErrorMessage(err, fallback)).toBe(fallback);
  });

  it("returns fallback when Error message is whitespace", () => {
    const err = new Error("   ");
    expect(extractErrorMessage(err, fallback)).toBe(fallback);
  });

  it("extracts message from a non-Error object with a message string", () => {
    const err = { message: "RPC defect: failed to spawn" };
    expect(extractErrorMessage(err, fallback)).toBe("RPC defect: failed to spawn");
  });

  it("formats objects carrying a _tag with the serialized payload", () => {
    const err = { _tag: "TerminalCwdError", cwd: "/tmp/missing", reason: "notFound" };
    expect(extractErrorMessage(err, fallback)).toContain("TerminalCwdError");
    expect(extractErrorMessage(err, fallback)).toContain("/tmp/missing");
  });

  it("prefers object.message over _tag formatting", () => {
    const err = { _tag: "Foo", message: "explicit message" };
    expect(extractErrorMessage(err, fallback)).toBe("explicit message");
  });

  it("returns string rejections directly", () => {
    expect(extractErrorMessage("a literal string defect", fallback)).toBe(
      "a literal string defect",
    );
  });

  it("returns fallback for null", () => {
    expect(extractErrorMessage(null, fallback)).toBe(fallback);
  });

  it("returns fallback for undefined", () => {
    expect(extractErrorMessage(undefined, fallback)).toBe(fallback);
  });

  it("returns fallback for numeric rejections", () => {
    expect(extractErrorMessage(42, fallback)).toBe(fallback);
  });

  it("survives circular objects without throwing", () => {
    const err: { _tag: string; self?: unknown } = { _tag: "Circular" };
    err.self = err;
    expect(extractErrorMessage(err, fallback)).toBe("Circular");
  });
});
