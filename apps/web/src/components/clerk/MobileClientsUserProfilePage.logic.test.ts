import type {
  RelayAndroidClientDeviceRecord,
  RelayClientDeviceRecord,
  RelayIosClientDeviceRecord,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileClientNotificationDetail,
  mobileClientPlatformLabel,
  mobileClientUpdatedAtLabel,
} from "./MobileClientsUserProfilePage.logic";

const defaultNotifications = {
  enabled: true,
  notifyOnApproval: true,
  notifyOnInput: false,
  notifyOnCompletion: true,
  notifyOnFailure: false,
} as const;

function iosDevice(overrides: Partial<RelayIosClientDeviceRecord> = {}): RelayClientDeviceRecord {
  return {
    deviceId: "device-1",
    label: "Julius’s iPhone",
    platform: "ios",
    iosMajorVersion: 18,
    appVersion: "1.2.3",
    notifications: defaultNotifications,
    liveActivities: { enabled: true },
    updatedAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

function androidDevice(
  overrides: Partial<RelayAndroidClientDeviceRecord> = {},
): RelayClientDeviceRecord {
  return {
    deviceId: "device-android",
    label: "Pixel 8",
    platform: "android",
    androidSdkVersion: 34,
    appVersion: "2.0.0",
    notifications: defaultNotifications,
    liveActivities: { enabled: false },
    updatedAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("mobile client presentation", () => {
  it("describes the client platform and enabled notification events", () => {
    const client = iosDevice();

    expect(mobileClientPlatformLabel(client)).toBe("iOS 18 · T3 Code 1.2.3");
    expect(mobileClientNotificationDetail(client)).toBe(
      "Alerts enabled for approvals, completions.",
    );
  });

  it("distinguishes disabled notifications from an empty event selection", () => {
    expect(
      mobileClientNotificationDetail(
        iosDevice({ notifications: { ...defaultNotifications, enabled: false } }),
      ),
    ).toBe("Push notifications are disabled on this device.");
    expect(
      mobileClientNotificationDetail(
        iosDevice({
          notifications: {
            enabled: true,
            notifyOnApproval: false,
            notifyOnInput: false,
            notifyOnCompletion: false,
            notifyOnFailure: false,
          },
        }),
      ),
    ).toBe("Push notifications are enabled, but no alert types are selected.");
  });

  it("handles missing app versions and invalid update timestamps", () => {
    expect(mobileClientPlatformLabel(iosDevice({ appVersion: null }))).toBe("iOS 18");
    expect(mobileClientUpdatedAtLabel("not-a-date")).toBe("Update time unavailable");
  });

  it("describes android clients with sdk version", () => {
    expect(mobileClientPlatformLabel(androidDevice())).toBe("Android SDK 34 · T3 Code 2.0.0");
  });
});
