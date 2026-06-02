import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { RightPanelSheet } from "./RightPanelSheet";
import { ToastProvider, toastManager } from "./ui/toast";

vi.mock("@tanstack/react-router", () => ({
  useParams: (options?: { select?: (params: Record<string, string | undefined>) => unknown }) =>
    options?.select ? options.select({}) : {},
}));

function RightPanelSheetHarness(props: { onClose: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <ToastProvider>
      <button data-testid="outside-control" type="button">
        Outside control
      </button>
      <RightPanelSheet
        open={open}
        onClose={() => {
          props.onClose();
          setOpen(false);
        }}
      >
        <div className="p-4">
          <p>Right panel content</p>
          <button
            type="button"
            onClick={() => {
              toastManager.add({
                type: "success",
                title: "Added to input",
                description: "@src/App.tsx",
              });
            }}
          >
            Add preview file
          </button>
        </div>
      </RightPanelSheet>
    </ToastProvider>
  );
}

describe("RightPanelSheet", () => {
  afterEach(() => {
    toastManager.close();
    document.body.innerHTML = "";
  });

  it("keeps the sheet open when a toast dismissal starts as an outside press", async () => {
    const onClose = vi.fn();
    const screen = await render(<RightPanelSheetHarness onClose={onClose} />);

    try {
      await page.getByRole("button", { name: "Add preview file" }).click();
      await expect.element(page.getByText("Added to input")).toBeVisible();

      await page.getByRole("button", { name: "Dismiss notification" }).click();

      expect(onClose).not.toHaveBeenCalled();
      await expect.element(page.getByText("Right panel content")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("still closes the sheet on ordinary outside presses", async () => {
    const onClose = vi.fn();
    const screen = await render(<RightPanelSheetHarness onClose={onClose} />);

    try {
      document.querySelector<HTMLButtonElement>('[data-testid="outside-control"]')?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
        }),
      );

      await vi.waitFor(() => {
        expect(onClose).toHaveBeenCalledOnce();
      });
    } finally {
      await screen.unmount();
    }
  });
});
