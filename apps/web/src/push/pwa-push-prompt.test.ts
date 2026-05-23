import { describe, expect, it } from "vitest";

import { shouldOfferPwaPushPrompt } from "./pwa-push-prompt";

const eligibleInput = {
  isStandalonePwa: true,
  pushSupported: true,
  permission: "default" as NotificationPermission,
  isSubscribed: false,
  promptHandled: false,
};

describe("shouldOfferPwaPushPrompt", () => {
  it("offers the prompt for an eligible standalone PWA launch", () => {
    expect(shouldOfferPwaPushPrompt(eligibleInput)).toBe(true);
  });

  it("does not offer the prompt in the browser tab", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        isStandalonePwa: false,
      }),
    ).toBe(false);
  });

  it("does not offer the prompt after it was handled", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        promptHandled: true,
      }),
    ).toBe(false);
  });

  it("does not offer the prompt when push is unsupported", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        pushSupported: false,
      }),
    ).toBe(false);
  });

  it("does not offer the prompt when permission is denied", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        permission: "denied",
      }),
    ).toBe(false);
  });

  it("does not offer the prompt when permission is unsupported", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        permission: "unsupported",
      }),
    ).toBe(false);
  });

  it("does not offer the prompt when already subscribed", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        isSubscribed: true,
      }),
    ).toBe(false);
  });

  it("offers the prompt when permission was already granted but not subscribed", () => {
    expect(
      shouldOfferPwaPushPrompt({
        ...eligibleInput,
        permission: "granted",
      }),
    ).toBe(true);
  });
});
