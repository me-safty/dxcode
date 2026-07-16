import { describe, expect, it } from "vite-plus/test";

import { inferFileExtension, inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";

describe("imageMime", () => {
  it("parses base64 data URL with mime type", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("parses base64 data URL with mime parameters", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("rejects non-base64 data URL", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8,hello")).toBeNull();
  });

  it("rejects missing mime type", () => {
    expect(parseBase64DataUrl("data:;base64,SGVsbG8=")).toBeNull();
  });

  it("parses base64 data URL with spaces in payload", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVs bG8=\n")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("does not read inherited keys from mime extension map", () => {
    expect(inferImageExtension({ mimeType: "constructor" })).toBe(".bin");
  });

  it("infers file extension from an allowlisted file name extension", () => {
    expect(
      inferFileExtension({ mimeType: "application/octet-stream", fileName: "report.PDF" }),
    ).toBe(".pdf");
  });

  it("infers file extension from the last segment of a multi-dot file name", () => {
    expect(inferFileExtension({ mimeType: "application/octet-stream", fileName: "a.b.csv" })).toBe(
      ".csv",
    );
  });

  it("falls back to an allowlisted mime extension when the file name extension is unsafe", () => {
    expect(inferFileExtension({ mimeType: "application/pdf", fileName: "notes.exe" })).toBe(".pdf");
  });

  it("falls back to an allowlisted mime extension when the file name has no extension", () => {
    expect(inferFileExtension({ mimeType: "text/plain", fileName: "notes" })).toBe(".txt");
  });

  it("defaults file extension to .bin when neither file name nor mime is allowlisted", () => {
    expect(inferFileExtension({ mimeType: "application/x-unknown", fileName: "payload.exe" })).toBe(
      ".bin",
    );
    expect(inferFileExtension({ mimeType: "application/x-unknown", fileName: "notes" })).toBe(
      ".bin",
    );
  });

  it("defaults dotfile names without an allowlisted mime to .bin", () => {
    expect(inferFileExtension({ mimeType: "application/x-unknown", fileName: ".env" })).toBe(
      ".bin",
    );
  });
});
