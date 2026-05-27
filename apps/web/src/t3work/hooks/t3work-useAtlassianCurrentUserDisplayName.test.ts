import { describe, expect, it } from "vitest";

import { writeIntegrationCache } from "~/t3work/hooks/t3work-integrationCache";

import {
  findAtlassianAccountDisplayName,
  readCachedAtlassianCurrentUserDisplayName,
} from "./t3work-useAtlassianCurrentUserDisplayName";

describe("use Atlassian current user display name", () => {
  it("finds the label for the current account from a loaded account list", () => {
    expect(
      findAtlassianAccountDisplayName(
        [
          { id: "account-1", provider: "atlassian", label: "Philip Jonientz" },
          { id: "account-2", provider: "atlassian", label: "Alex" },
        ],
        "account-1",
      ),
    ).toBe("Philip Jonientz");
  });

  it("reads the current account label from the integration cache", () => {
    writeIntegrationCache("atlassian:listAccounts", [
      { id: "account-1", provider: "atlassian", label: "Philip Jonientz" },
    ]);

    expect(readCachedAtlassianCurrentUserDisplayName("account-1")).toBe("Philip Jonientz");
  });
});
