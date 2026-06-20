import { Linking } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { tryOpenExternalUrl } from "./openExternalUrl";

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
}));

const openURL = vi.mocked(Linking.openURL);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tryOpenExternalUrl", () => {
  it("opens supported URLs", async () => {
    openURL.mockResolvedValue(undefined);

    await expect(
      tryOpenExternalUrl("https://github.com/pingdotgg/t3code", "pull-request"),
    ).resolves.toBe(true);
  });

  it("logs stable URL context with the exact opening failure", async () => {
    const cause = new Error("browser unavailable");
    openURL.mockRejectedValue(cause);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      tryOpenExternalUrl("https://github.com/pingdotgg/t3code/pull/1?token=secret", "pull-request"),
    ).resolves.toBe(false);

    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "ExternalUrlOpenError",
        target: "pull-request",
        scheme: "https",
        host: "github.com",
        cause,
      }),
    );
    const loggedError = consoleError.mock.calls[0]?.[0];
    expect(loggedError).not.toHaveProperty("url");
    expect(JSON.stringify(loggedError)).not.toContain("token=secret");
  });
});
