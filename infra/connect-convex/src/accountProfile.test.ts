import { describe, expect, it } from "vite-plus/test";

import {
  FREE_PLAN_LABEL,
  accountProfileFromIdentity,
  accountProfileFromStoredUser,
} from "./accountProfile.ts";

describe("accountProfileFromIdentity", () => {
  it("maps Clerk identity claims into the v1 Free account profile", () => {
    expect(
      accountProfileFromIdentity({
        tokenIdentifier: "https://clerk.example.test|user_123",
        issuer: "https://clerk.example.test",
        subject: "user_123",
        email: "corey@example.test",
        pictureUrl: "https://images.example.test/corey.png",
      }),
    ).toEqual({
      clerkUserId: "user_123",
      primaryEmail: "corey@example.test",
      imageUrl: "https://images.example.test/corey.png",
      planLabel: FREE_PLAN_LABEL,
    });
  });

  it("uses null display fields when Clerk does not provide optional claims", () => {
    expect(
      accountProfileFromIdentity({
        tokenIdentifier: "https://clerk.example.test|user_123",
        issuer: "https://clerk.example.test",
        subject: "user_123",
      }),
    ).toMatchObject({
      primaryEmail: null,
      imageUrl: null,
    });
  });
});

describe("accountProfileFromStoredUser", () => {
  it("keeps the v1 plan label hardcoded to Free", () => {
    expect(
      accountProfileFromStoredUser({
        clerkUserId: "user_123",
        primaryEmail: "corey@example.test",
        imageUrl: null,
      }).planLabel,
    ).toBe("Free");
  });
});
