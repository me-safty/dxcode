import { describe, expect, it } from "@effect/vitest";

import { makeRelayDeviceRegistrationRequest } from "./registrationPayload";

describe("makeRelayDeviceRegistrationRequest", () => {
  it("builds iOS registrations with Live Activity preferences", () => {
    expect(
      makeRelayDeviceRegistrationRequest({
        deviceId: "device-1",
        label: "Julius's iPhone",
        platform: "ios",
        iosMajorVersion: 18,
        appVersion: "1.0.0",
        pushToken: "apns-token",
        pushToStartToken: "push-to-start-token",
        notificationsEnabled: true,
        preferences: {
          liveActivitiesEnabled: false,
        },
      }),
    ).toEqual({
      deviceId: "device-1",
      label: "Julius's iPhone",
      platform: "ios",
      iosMajorVersion: 18,
      appVersion: "1.0.0",
      pushToken: "apns-token",
      pushToStartToken: "push-to-start-token",
      preferences: {
        liveActivitiesEnabled: false,
        notificationsEnabled: true,
        notifyOnApproval: true,
        notifyOnInput: true,
        notifyOnCompletion: true,
        notifyOnFailure: true,
      },
    });
  });

  it("builds Android registrations with live activities forced off", () => {
    expect(
      makeRelayDeviceRegistrationRequest({
        deviceId: "device-2",
        label: "Pixel 8",
        platform: "android",
        androidSdkVersion: 35,
        appVersion: "1.0.0",
        pushToken: "fcm-token",
        notificationsEnabled: true,
        preferences: {
          liveActivitiesEnabled: true,
        },
      }),
    ).toEqual({
      deviceId: "device-2",
      label: "Pixel 8",
      platform: "android",
      androidSdkVersion: 35,
      appVersion: "1.0.0",
      pushToken: "fcm-token",
      preferences: {
        liveActivitiesEnabled: false,
        notificationsEnabled: true,
        notifyOnApproval: true,
        notifyOnInput: true,
        notifyOnCompletion: true,
        notifyOnFailure: true,
      },
    });
  });
});
