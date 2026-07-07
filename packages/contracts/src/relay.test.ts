import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { describe, expect, it } from "vite-plus/test";

import { RelayAgentAwarenessPlatform, RelayApi, RelayDeviceRegistrationRequest } from "./relay.ts";

const decodeRegistration = Schema.decodeUnknownSync(RelayDeviceRegistrationRequest);
const decodePlatform = Schema.decodeUnknownSync(RelayAgentAwarenessPlatform);

const preferences = {
  liveActivitiesEnabled: false,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: false,
  notifyOnCompletion: true,
  notifyOnFailure: false,
} as const;

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});

describe("RelayAgentAwarenessPlatform", () => {
  it("includes ios and android", () => {
    expect(decodePlatform("ios")).toBe("ios");
    expect(decodePlatform("android")).toBe("android");
  });
});

describe("RelayDeviceRegistrationRequest", () => {
  it("accepts ios registration with iosMajorVersion", () => {
    expect(
      decodeRegistration({
        deviceId: "device-ios",
        label: "Julius iPhone",
        platform: "ios",
        iosMajorVersion: 18,
        preferences,
      }),
    ).toMatchObject({
      platform: "ios",
      iosMajorVersion: 18,
    });
  });

  it("rejects ios registration without iosMajorVersion", () => {
    expect(() =>
      decodeRegistration({
        deviceId: "device-ios",
        label: "Julius iPhone",
        platform: "ios",
        preferences,
      }),
    ).toThrow();
  });

  it("accepts android registration with androidSdkVersion", () => {
    expect(
      decodeRegistration({
        deviceId: "device-android",
        label: "Pixel",
        platform: "android",
        androidSdkVersion: 34,
        pushToken: "fcm-token",
        preferences,
      }),
    ).toMatchObject({
      platform: "android",
      androidSdkVersion: 34,
      pushToken: "fcm-token",
    });
  });

  it("rejects android registration without androidSdkVersion", () => {
    expect(() =>
      decodeRegistration({
        deviceId: "device-android",
        label: "Pixel",
        platform: "android",
        preferences,
      }),
    ).toThrow();
  });

  it("rejects android registration with pushToStartToken", () => {
    expect(() =>
      decodeRegistration({
        deviceId: "device-android",
        label: "Pixel",
        platform: "android",
        androidSdkVersion: 34,
        pushToStartToken: "must-not-send",
        preferences,
      }),
    ).toThrow();
  });
});
