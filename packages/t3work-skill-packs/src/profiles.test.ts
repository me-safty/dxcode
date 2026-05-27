import { describe, expect, it } from "vitest";

import {
  getT3WorkProfile,
  listT3WorkProfiles,
  resolveT3WorkProfileId,
  toRecipeProfileContext,
} from "./profiles.js";

describe("resolveT3WorkProfileId", () => {
  it("maps legacy setup profile ids onto the canonical bundled profiles", () => {
    expect(resolveT3WorkProfileId("developer")).toBe("engineering-copilot");
    expect(resolveT3WorkProfileId("requirements-engineer")).toBe("product-partner");
    expect(resolveT3WorkProfileId("test-engineer")).toBe("qa-assistant");
  });

  it("lists the bundled starter profiles and exposes matcher-ready preference fields", () => {
    expect(listT3WorkProfiles()).toHaveLength(6);
    expect(toRecipeProfileContext(getT3WorkProfile("engineering-copilot"))).toMatchObject({
      technicalDepth: "high",
      guidanceStyle: "expert",
      detailDensity: "expert",
    });
  });
});
