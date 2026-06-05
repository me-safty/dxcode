import "../../index.css";

import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { DesktopClerkWaitlist } from "./DesktopClerkWaitlist";

const waitlistJoinMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const useWaitlistMock = vi.hoisted(() =>
  vi.fn(() => ({
    errors: {
      fields: {
        emailAddress: null,
      },
      global: null,
      raw: null,
    },
    fetchStatus: "idle",
    waitlist: {
      id: "",
      join: waitlistJoinMock,
    },
  })),
);

vi.mock("@clerk/react", () => ({
  useClerk: () => ({}),
  useSignIn: () => ({ isLoaded: true, signIn: null }),
  useSignUp: () => ({ isLoaded: true, signUp: null }),
  useWaitlist: useWaitlistMock,
}));

describe("DesktopClerkWaitlist", () => {
  beforeEach(() => {
    waitlistJoinMock.mockReset();
    waitlistJoinMock.mockResolvedValue({ error: null });
    useWaitlistMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders Clerk's CAPTCHA mount point for protected custom waitlist flows", async () => {
    await render(<DesktopClerkWaitlist />);

    const captcha = document.querySelector("#clerk-captcha");

    expect(captcha).not.toBeNull();
    expect(captcha?.getAttribute("data-cl-size")).toBe("flexible");
  });

  it("submits through Clerk's waitlist resource from provider context", async () => {
    await render(<DesktopClerkWaitlist />);

    await userEvent.type(page.getByLabelText("Email address"), " desktop@example.com ");
    await userEvent.click(page.getByRole("button", { name: "Join the waitlist" }));

    expect(waitlistJoinMock).toHaveBeenCalledWith({ emailAddress: "desktop@example.com" });
  });
});
