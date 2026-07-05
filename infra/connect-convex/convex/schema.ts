import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const isoTimestamp = v.string();

const managedEndpointProviderKind = v.union(
  v.literal("manual"),
  v.literal("cloudflare_tunnel"),
  v.literal("pathwayos_relay"),
);

const remoteProviderKind = v.union(v.literal("cloudflare_tunnel"));

const managedEndpoint = v.object({
  httpBaseUrl: v.string(),
  wsBaseUrl: v.string(),
  providerKind: managedEndpointProviderKind,
});

const relayAgentActivityPhase = v.union(
  v.literal("starting"),
  v.literal("running"),
  v.literal("waiting_for_approval"),
  v.literal("waiting_for_input"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("stale"),
);

const relayAgentActivityState = v.object({
  environmentId: v.string(),
  threadId: v.string(),
  projectTitle: v.string(),
  threadTitle: v.string(),
  phase: relayAgentActivityPhase,
  headline: v.string(),
  detail: v.optional(v.string()),
  modelTitle: v.string(),
  updatedAt: isoTimestamp,
  deepLink: v.string(),
});

const relayAgentActivityAggregateRow = v.object({
  environmentId: v.string(),
  threadId: v.string(),
  projectTitle: v.string(),
  threadTitle: v.string(),
  modelTitle: v.string(),
  phase: relayAgentActivityPhase,
  status: v.string(),
  updatedAt: isoTimestamp,
  deepLink: v.string(),
});

const relayAgentActivityAggregateState = v.object({
  title: v.string(),
  subtitle: v.string(),
  activeCount: v.number(),
  updatedAt: isoTimestamp,
  activities: v.array(relayAgentActivityAggregateRow),
});

const agentAwarenessPreferences = v.object({
  liveActivitiesEnabled: v.boolean(),
  notificationsEnabled: v.boolean(),
  notifyOnApproval: v.boolean(),
  notifyOnInput: v.boolean(),
  notifyOnCompletion: v.boolean(),
  notifyOnFailure: v.boolean(),
});

export default defineSchema({
  connectUsers: defineTable({
    clerkUserId: v.string(),
    primaryEmail: v.union(v.null(), v.string()),
    imageUrl: v.union(v.null(), v.string()),
    planLabel: v.string(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  }).index("by_clerk_user_id", ["clerkUserId"]),

  environmentLinks: defineTable({
    userId: v.string(),
    environmentId: v.string(),
    environmentLabel: v.string(),
    environmentPublicKey: v.string(),
    endpoint: managedEndpoint,
    notificationsEnabled: v.boolean(),
    liveActivitiesEnabled: v.boolean(),
    remoteAccessEnabled: v.boolean(),
    createdByDeviceId: v.union(v.null(), v.string()),
    revokedAt: v.union(v.null(), isoTimestamp),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
    .index("by_user", ["userId"])
    .index("by_user_environment", ["userId", "environmentId"])
    .index("by_environment", ["environmentId", "revokedAt"]),

  remoteConnectionRequests: defineTable({
    userId: v.string(),
    environmentId: v.string(),
    providerKind: remoteProviderKind,
    status: v.union(
      v.literal("requested"),
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("deprovisioning"),
      v.literal("disabled"),
    ),
    requestedAt: isoTimestamp,
    updatedAt: isoTimestamp,
    errorMessage: v.union(v.null(), v.string()),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_environment", ["environmentId"])
    .index("by_user_environment", ["userId", "environmentId"]),

  providerAllocations: defineTable({
    userId: v.string(),
    environmentId: v.string(),
    providerKind: remoteProviderKind,
    hostname: v.string(),
    tunnelId: v.union(v.null(), v.string()),
    tunnelName: v.string(),
    dnsRecordId: v.union(v.null(), v.string()),
    readyAt: v.union(v.null(), isoTimestamp),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
    .index("by_provider", ["providerKind"])
    .index("by_user_environment", ["userId", "environmentId"])
    .index("by_hostname", ["hostname"])
    .index("by_tunnel_name", ["tunnelName"]),

  environmentCredentials: defineTable({
    credentialId: v.string(),
    environmentId: v.string(),
    environmentPublicKey: v.string(),
    credentialHash: v.string(),
    revokedAt: v.union(v.null(), isoTimestamp),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
    .index("by_credential_hash", ["credentialHash"])
    .index("by_environment", ["environmentId", "revokedAt"])
    .index("by_environment_key", ["environmentId", "environmentPublicKey", "revokedAt"]),

  dpopProofs: defineTable({
    thumbprint: v.string(),
    jti: v.string(),
    iat: v.number(),
    expiresAt: isoTimestamp,
    createdAt: isoTimestamp,
  })
    .index("by_thumbprint_jti", ["thumbprint", "jti"])
    .index("by_expires_at", ["expiresAt"]),

  mobileDevices: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    label: v.string(),
    platform: v.literal("ios"),
    iosMajorVersion: v.number(),
    appVersion: v.union(v.null(), v.string()),
    pushToken: v.union(v.null(), v.string()),
    pushToStartToken: v.union(v.null(), v.string()),
    preferences: agentAwarenessPreferences,
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"])
    .index("by_push_token", ["pushToken"])
    .index("by_push_to_start_token", ["pushToStartToken"]),

  liveActivities: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    activityPushToken: v.union(v.null(), v.string()),
    remoteStartQueuedAt: v.union(v.null(), isoTimestamp),
    remoteStartedAt: v.union(v.null(), isoTimestamp),
    endedAt: v.union(v.null(), isoTimestamp),
    lastAggregate: v.union(v.null(), relayAgentActivityAggregateState),
    lastLiveActivityDeliveryAt: v.union(v.null(), isoTimestamp),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"])
    .index("by_activity_push_token", ["activityPushToken"]),

  agentActivityRows: defineTable({
    environmentId: v.string(),
    environmentPublicKey: v.string(),
    threadId: v.string(),
    state: relayAgentActivityState,
    updatedAt: isoTimestamp,
    createdAt: isoTimestamp,
  })
    .index("by_environment_thread", ["environmentId", "environmentPublicKey", "threadId"])
    .index("by_updated_at", ["updatedAt"]),

  deliveryAttempts: defineTable({
    id: v.string(),
    createdAt: isoTimestamp,
    userId: v.union(v.null(), v.string()),
    environmentId: v.union(v.null(), v.string()),
    threadId: v.union(v.null(), v.string()),
    deviceId: v.union(v.null(), v.string()),
    kind: v.union(
      v.literal("live_activity_start"),
      v.literal("live_activity_update"),
      v.literal("live_activity_end"),
      v.literal("push_notification"),
    ),
    sourceJobId: v.union(v.null(), v.string()),
    tokenSuffix: v.union(v.null(), v.string()),
    apnsStatus: v.union(v.null(), v.number()),
    apnsReason: v.union(v.null(), v.string()),
    apnsId: v.union(v.null(), v.string()),
    transportError: v.union(v.null(), v.string()),
  })
    .index("by_source_job", ["sourceJobId"])
    .index("by_environment_thread_created", ["environmentId", "threadId", "createdAt"]),
});
