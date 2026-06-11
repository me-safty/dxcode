import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Sidebar, SidebarProvider, SidebarTrigger } from "./sidebar";
import { ToastProvider, toastManager } from "./toast";

vi.mock("@tanstack/react-router", () => ({
  useParams: (options?: { select?: (params: Record<string, string | undefined>) => unknown }) =>
    options?.select ? options.select({}) : {},
}));

function MobileSidebarHarness() {
  return (
    <ToastProvider>
      <SidebarProvider>
        <button data-testid="outside-control" type="button">
          Outside control
        </button>
        <Sidebar collapsible="offcanvas" side="left">
          <div className="p-4">
            <p>Mobile sidebar content</p>
            <button
              type="button"
              onClick={() => {
                toastManager.add({
                  type: "success",
                  title: "Sidebar toast",
                  description: "Dismiss me",
                });
              }}
            >
              Show toast
            </button>
          </div>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    </ToastProvider>
  );
}

describe("mobile Sidebar", () => {
  afterEach(async () => {
    toastManager.close();
    document.body.innerHTML = "";
    await page.viewport(1024, 768);
  });

  it("keeps the mobile sidebar open when a toast dismissal starts as an outside press", async () => {
    await page.viewport(390, 700);
    const screen = await render(<MobileSidebarHarness />);

    try {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect.element(page.getByText("Mobile sidebar content")).toBeVisible();

      await page.getByRole("button", { name: "Show toast" }).click();
      await expect.element(page.getByText("Sidebar toast")).toBeVisible();

      await page.getByRole("button", { name: "Dismiss notification" }).click();

      await expect.element(page.getByText("Mobile sidebar content")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("still closes the mobile sidebar on ordinary outside presses", async () => {
    await page.viewport(390, 700);
    const screen = await render(<MobileSidebarHarness />);

    try {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect.element(page.getByText("Mobile sidebar content")).toBeVisible();

      document.querySelector<HTMLButtonElement>('[data-testid="outside-control"]')?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
        }),
      );

      await vi.waitFor(() => {
        expect(document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]')).toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });
});
