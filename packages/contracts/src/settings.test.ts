import { describe, expect, it } from "vitest";

import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_FOLLOW_UP_BEHAVIOR,
} from "./settings";
import { Schema } from "effect";

describe("client follow-up behavior settings", () => {
  it("defaults follow-up behavior to steer", () => {
    expect(DEFAULT_CLIENT_SETTINGS.followUpBehavior).toBe(DEFAULT_FOLLOW_UP_BEHAVIOR);
    expect(Schema.decodeSync(ClientSettingsSchema)({}).followUpBehavior).toBe("steer");
  });
});
