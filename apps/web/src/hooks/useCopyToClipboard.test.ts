import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { writeClipboardText } from "./useCopyToClipboard";

type FakeTextArea = {
  focus: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  value: string;
};

function installClipboardGlobals(input: {
  execCommand?: ReturnType<typeof vi.fn>;
  writeText?: ReturnType<typeof vi.fn>;
}) {
  const textArea: FakeTextArea = {
    focus: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    setAttribute: vi.fn(),
    style: {},
    value: "",
  };
  const appendChild = vi.fn();
  const document = {
    body: {
      appendChild,
    },
    createElement: vi.fn(() => textArea),
    execCommand: input.execCommand ?? vi.fn(() => true),
  };

  vi.stubGlobal("window", { document });
  vi.stubGlobal("navigator", {
    clipboard: input.writeText ? { writeText: input.writeText } : undefined,
  });

  return { appendChild, document, textArea };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeClipboardText", () => {
  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn(async () => undefined);
    const { document } = installClipboardGlobals({ writeText });

    await writeClipboardText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the async Clipboard API rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const execCommand = vi.fn(() => true);
    const { appendChild, document, textArea } = installClipboardGlobals({ execCommand, writeText });

    await writeClipboardText("fallback text");

    expect(writeText).toHaveBeenCalledWith("fallback text");
    expect(document.createElement).toHaveBeenCalledWith("textarea");
    expect(textArea.value).toBe("fallback text");
    expect(appendChild).toHaveBeenCalledWith(textArea);
    expect(textArea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textArea.remove).toHaveBeenCalled();
  });
});
