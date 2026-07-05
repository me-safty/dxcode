import { describe, expect, it } from "vite-plus/test";

import {
  resolveRemoteProviderRequirement,
  requiresRemoteProvider,
  type ConnectCapability,
} from "./remoteProvider.ts";

const accountCapabilities = [
  "account_profile",
  "account_sync",
  "environment_listing",
  "device_listing",
  "environment_link_challenge",
  "environment_link",
  "mobile_registration",
  "agent_activity_publish",
] satisfies ReadonlyArray<ConnectCapability>;

const remoteCapabilities = [
  "remote_connection_create",
  "remote_connection_status",
  "remote_connection_connect",
  "remote_connection_delete",
] satisfies ReadonlyArray<ConnectCapability>;

describe("remote provider boundary", () => {
  it("keeps Cloudflare out of account, sync, and ordinary link capabilities", () => {
    for (const capability of accountCapabilities) {
      expect(requiresRemoteProvider(capability)).toBe(false);
      expect(resolveRemoteProviderRequirement(capability)).toEqual({
        required: false,
        providerKind: null,
        reason: "This Connect capability does not expose a remote environment endpoint.",
      });
    }
  });

  it("requires a provider only for explicit remote connection capabilities", () => {
    for (const capability of remoteCapabilities) {
      expect(requiresRemoteProvider(capability)).toBe(true);
      expect(resolveRemoteProviderRequirement(capability)).toEqual({
        required: true,
        providerKind: "cloudflare_tunnel",
        reason: "Remote endpoint access requires an explicit remote access provider.",
      });
    }
  });
});
