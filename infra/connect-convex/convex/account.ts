import {
  mutationGeneric,
  queryGeneric,
  type DataModelFromSchemaDefinition,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import { v } from "convex/values";
import * as DateTime from "effect/DateTime";

import type schema from "./schema.ts";
import {
  FREE_PLAN_LABEL,
  accountProfileFromIdentity,
  accountProfileFromStoredUser,
} from "../src/accountProfile.ts";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;

const accountProfileValidator = v.object({
  clerkUserId: v.string(),
  primaryEmail: v.union(v.null(), v.string()),
  imageUrl: v.union(v.null(), v.string()),
  planLabel: v.literal(FREE_PLAN_LABEL),
});

type ConnectUserDbContext =
  | Pick<GenericQueryCtx<DataModel>, "db">
  | Pick<GenericMutationCtx<DataModel>, "db">;

async function storedUserByClerkId(ctx: ConnectUserDbContext, clerkUserId: string) {
  return await ctx.db
    .query("connectUsers")
    .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
}

export const viewer = queryGeneric({
  args: {},
  returns: v.union(v.null(), accountProfileValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return null;
    }

    const storedUser = await storedUserByClerkId(ctx, identity.subject);
    return storedUser === null
      ? accountProfileFromIdentity(identity)
      : accountProfileFromStoredUser(storedUser);
  },
});

export const bootstrap = mutationGeneric({
  args: {},
  returns: accountProfileValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("UNAUTHENTICATED");
    }

    const now = DateTime.formatIso(DateTime.nowUnsafe());
    const profile = accountProfileFromIdentity(identity);
    const storedUser = await storedUserByClerkId(ctx, identity.subject);

    if (storedUser === null) {
      await ctx.db.insert("connectUsers", {
        clerkUserId: profile.clerkUserId,
        primaryEmail: profile.primaryEmail,
        imageUrl: profile.imageUrl,
        planLabel: profile.planLabel,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("connectUsers", storedUser._id, {
        primaryEmail: profile.primaryEmail,
        imageUrl: profile.imageUrl,
        planLabel: profile.planLabel,
        updatedAt: now,
      });
    }

    return profile;
  },
});
