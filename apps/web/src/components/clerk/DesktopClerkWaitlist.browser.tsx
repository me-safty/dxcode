import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { Dialog, DialogPopup } from "../ui/dialog";
import { DesktopClerkWaitlist } from "./DesktopClerkWaitlist";

const mockJoinWaitlist = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({
    joinWaitlist: mockJoinWaitlist,
  }),
}));

vi.mock("./DesktopClerkSignIn", () => ({
  DesktopClerkSignIn: () => null,
}));

describe("DesktopClerkWaitlist", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockJoinWaitlist.mockClear();
  });

  it("keeps the desktop waitlist card flush with the transparent dialog wrapper", async () => {
    await page.viewport(960, 1100);

    await render(
      <Dialog open onOpenChange={() => {}}>
        <DialogPopup
          className="max-w-[25rem] border-0 bg-transparent shadow-none outline-none before:hidden"
          showCloseButton={false}
        >
          <DesktopClerkWaitlist />
        </DialogPopup>
      </Dialog>,
    );

    await page.getByLabelText("Email address").fill("person@example.com");
    await page.getByRole("button", { name: "Join the waitlist" }).click();

    await expect.element(page.getByText("Thanks for joining the waitlist!")).toBeInTheDocument();
    expect(mockJoinWaitlist).toHaveBeenCalledWith({ emailAddress: "person@example.com" });

    const popup = document.querySelector<HTMLElement>('[data-slot="dialog-popup"]');
    expect(popup).not.toBeNull();
    expect(window.getComputedStyle(popup!).outlineStyle).toBe("none");

    const card = popup!.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();

    const popupRect = popup!.getBoundingClientRect();
    const cardRect = card!.getBoundingClientRect();
    expect(Math.abs(popupRect.width - cardRect.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(popupRect.right - cardRect.right)).toBeLessThanOrEqual(1);
  });
});
