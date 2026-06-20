import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Notifications from "expo-notifications";
import { vi } from "vite-plus/test";

import {
  AgentNotificationPermissionError,
  requestAgentNotificationPermission,
} from "./notificationPermissions";

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

describe("requestAgentNotificationPermission", () => {
  it.effect("preserves permission lookup failures", () => {
    const cause = new Error("notification service unavailable");
    vi.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(cause);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(requestAgentNotificationPermission);

      expect(error).toBeInstanceOf(AgentNotificationPermissionError);
      expect(error).toMatchObject({
        _tag: "AgentNotificationPermissionError",
        operation: "read",
        cause,
        message: "Failed to read agent notification permissions.",
      });
    });
  });

  it.effect("preserves permission request failures", () => {
    const cause = new Error("permission prompt unavailable");
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockRejectedValueOnce(cause);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(requestAgentNotificationPermission);

      expect(error).toBeInstanceOf(AgentNotificationPermissionError);
      expect(error).toMatchObject({
        _tag: "AgentNotificationPermissionError",
        operation: "request",
        cause,
        message: "Failed to request agent notification permissions.",
      });
    });
  });
});
