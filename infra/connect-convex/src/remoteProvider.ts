import * as Schema from "effect/Schema";

export const RemoteAccessProviderKind = Schema.Literals(["cloudflare_tunnel"]);
export type RemoteAccessProviderKind = typeof RemoteAccessProviderKind.Type;

export const ConnectCapability = Schema.Literals([
  "account_profile",
  "account_sync",
  "environment_listing",
  "device_listing",
  "environment_link_challenge",
  "environment_link",
  "remote_connection_create",
  "remote_connection_status",
  "remote_connection_connect",
  "remote_connection_delete",
  "mobile_registration",
  "agent_activity_publish",
]);
export type ConnectCapability = typeof ConnectCapability.Type;

export const RemoteProviderRequirement = Schema.Struct({
  required: Schema.Boolean,
  providerKind: Schema.NullOr(RemoteAccessProviderKind),
  reason: Schema.String,
});
export type RemoteProviderRequirement = typeof RemoteProviderRequirement.Type;

const remoteProviderCapabilities = new Set<ConnectCapability>([
  "remote_connection_create",
  "remote_connection_status",
  "remote_connection_connect",
  "remote_connection_delete",
]);

export function requiresRemoteProvider(capability: ConnectCapability): boolean {
  return remoteProviderCapabilities.has(capability);
}

export function resolveRemoteProviderRequirement(
  capability: ConnectCapability,
): RemoteProviderRequirement {
  if (!requiresRemoteProvider(capability)) {
    return {
      required: false,
      providerKind: null,
      reason: "This Connect capability does not expose a remote environment endpoint.",
    };
  }

  return {
    required: true,
    providerKind: "cloudflare_tunnel",
    reason: "Remote endpoint access requires an explicit remote access provider.",
  };
}

export function assertRemoteProviderNotRequired(capability: ConnectCapability): void {
  const requirement = resolveRemoteProviderRequirement(capability);
  if (requirement.required) {
    throw new Error(`Remote provider is required for ${capability}.`);
  }
}
