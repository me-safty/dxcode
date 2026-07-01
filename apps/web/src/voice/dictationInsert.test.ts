import { describe, expect, it } from "vite-plus/test";
import { dictationInsertText } from "./dictationInsert.ts";

describe("dictationInsertText", () => {
  it("returns empty string for a blank chunk", () => {
    expect(dictationInsertText("hello", 5, "   ")).toBe("");
  });
  it("inserts without a leading space at the start", () => {
    expect(dictationInsertText("", 0, "hello world")).toBe("hello world");
  });
  it("adds a leading space after a word character", () => {
    expect(dictationInsertText("hello", 5, "world")).toBe(" world");
  });
  it("does not double a space when one precedes the cursor", () => {
    expect(dictationInsertText("hello ", 6, "world")).toBe("world");
  });
  it("does not add a space after a newline", () => {
    expect(dictationInsertText("hello\n", 6, "world")).toBe("world");
  });
  it("trims surrounding whitespace from the chunk", () => {
    expect(dictationInsertText("", 0, "  hi there  ")).toBe("hi there");
  });
});
