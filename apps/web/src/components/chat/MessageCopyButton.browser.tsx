import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { MessageCopyButton } from "./MessageCopyButton";

describe("MessageCopyButton", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommand = document.execCommand.bind(document);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    try {
      await render(<MessageCopyButton text="smoke-ok" />);
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(execCommand).toHaveBeenCalledWith("copy");
      });
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
      document.execCommand = originalExecCommand;
    }
  });
});
