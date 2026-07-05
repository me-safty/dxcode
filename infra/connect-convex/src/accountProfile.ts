import type { UserIdentity } from "convex/server";

export const FREE_PLAN_LABEL = "Free";

export interface ConnectAccountProfile {
  readonly clerkUserId: string;
  readonly primaryEmail: string | null;
  readonly imageUrl: string | null;
  readonly planLabel: typeof FREE_PLAN_LABEL;
}

export interface StoredConnectUser {
  readonly clerkUserId: string;
  readonly primaryEmail: string | null;
  readonly imageUrl: string | null;
}

export function accountProfileFromIdentity(identity: UserIdentity): ConnectAccountProfile {
  return {
    clerkUserId: identity.subject,
    primaryEmail: identity.email ?? null,
    imageUrl: identity.pictureUrl ?? null,
    planLabel: FREE_PLAN_LABEL,
  };
}

export function accountProfileFromStoredUser(user: StoredConnectUser): ConnectAccountProfile {
  return {
    clerkUserId: user.clerkUserId,
    primaryEmail: user.primaryEmail,
    imageUrl: user.imageUrl,
    planLabel: FREE_PLAN_LABEL,
  };
}
