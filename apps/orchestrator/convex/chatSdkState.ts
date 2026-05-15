import { v } from "convex/values";
import * as DateTime from "effect/DateTime";

import { internalMutation } from "./_generated/server.js";

function now() {
  return DateTime.toEpochMillis(DateTime.nowUnsafe());
}

function lockToken() {
  return `${now()}:${Math.random().toString(36).slice(2)}`;
}

async function getCacheRow(ctx: any, key: string) {
  return ctx.db
    .query("chatSdkCache")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .unique();
}

async function getListRow(ctx: any, key: string) {
  return ctx.db
    .query("chatSdkLists")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .unique();
}

async function getQueueRow(ctx: any, threadId: string) {
  return ctx.db
    .query("chatSdkQueues")
    .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
    .unique();
}

export const subscribe = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timestamp = now();
    const existing = await ctx.db
      .query("chatSdkSubscriptions")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    if (existing === null) {
      await ctx.db.insert("chatSdkSubscriptions", {
        threadId: args.threadId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.patch(existing._id, { updatedAt: timestamp });
    }
    return null;
  },
});

export const unsubscribe = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatSdkSubscriptions")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const isSubscribed = internalMutation({
  args: { threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatSdkSubscriptions")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    return existing !== null;
  },
});

export const acquireLock = internalMutation({
  args: { threadId: v.string(), ttlMs: v.number() },
  returns: v.union(
    v.null(),
    v.object({ threadId: v.string(), token: v.string(), expiresAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const timestamp = now();
    const expiresAt = timestamp + args.ttlMs;
    const existing = await ctx.db
      .query("chatSdkLocks")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();

    if (existing !== null && existing.expiresAt > timestamp) {
      return null;
    }

    const token = lockToken();
    if (existing === null) {
      await ctx.db.insert("chatSdkLocks", {
        threadId: args.threadId,
        token,
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.patch(existing._id, { token, expiresAt, updatedAt: timestamp });
    }
    return { threadId: args.threadId, token, expiresAt };
  },
});

export const releaseLock = internalMutation({
  args: { threadId: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatSdkLocks")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    if (existing !== null && existing.token === args.token) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const forceReleaseLock = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatSdkLocks")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const extendLock = internalMutation({
  args: { threadId: v.string(), token: v.string(), ttlMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatSdkLocks")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .unique();
    if (existing === null || existing.token !== args.token) return false;
    await ctx.db.patch(existing._id, {
      expiresAt: now() + args.ttlMs,
      updatedAt: now(),
    });
    return true;
  },
});

export const get = internalMutation({
  args: { key: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await getCacheRow(ctx, args.key);
    if (row === null) return null;
    if (row.expiresAt !== undefined && row.expiresAt <= now()) {
      await ctx.db.delete(row._id);
      return null;
    }
    return row.valueJson;
  },
});

export const set = internalMutation({
  args: { key: v.string(), valueJson: v.string(), ttlMs: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timestamp = now();
    const expiresAt = args.ttlMs === undefined ? undefined : timestamp + args.ttlMs;
    const row = await getCacheRow(ctx, args.key);
    if (row === null) {
      await ctx.db.insert("chatSdkCache", {
        key: args.key,
        valueJson: args.valueJson,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    } else {
      await ctx.db.patch(row._id, {
        valueJson: args.valueJson,
        updatedAt: timestamp,
        expiresAt,
      });
    }
    return null;
  },
});

export const setIfNotExists = internalMutation({
  args: { key: v.string(), valueJson: v.string(), ttlMs: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const timestamp = now();
    const expiresAt = args.ttlMs === undefined ? undefined : timestamp + args.ttlMs;
    const row = await getCacheRow(ctx, args.key);
    if (row !== null && (row.expiresAt === undefined || row.expiresAt > timestamp)) {
      return false;
    }
    if (row === null) {
      await ctx.db.insert("chatSdkCache", {
        key: args.key,
        valueJson: args.valueJson,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    } else {
      await ctx.db.patch(row._id, {
        valueJson: args.valueJson,
        updatedAt: timestamp,
        expiresAt,
      });
    }
    return true;
  },
});

export const deleteKey = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await getCacheRow(ctx, args.key);
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

export const appendToList = internalMutation({
  args: {
    key: v.string(),
    valueJson: v.string(),
    maxLength: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timestamp = now();
    const expiresAt = args.ttlMs === undefined ? undefined : timestamp + args.ttlMs;
    const row = await getListRow(ctx, args.key);
    const values =
      row === null || (row.expiresAt !== undefined && row.expiresAt <= timestamp)
        ? []
        : row.valuesJson;
    const nextValues = [...values, args.valueJson].slice(-(args.maxLength ?? values.length + 1));
    if (row === null) {
      await ctx.db.insert("chatSdkLists", {
        key: args.key,
        valuesJson: nextValues,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    } else {
      await ctx.db.patch(row._id, {
        valuesJson: nextValues,
        updatedAt: timestamp,
        expiresAt,
      });
    }
    return null;
  },
});

export const getList = internalMutation({
  args: { key: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const row = await getListRow(ctx, args.key);
    if (row === null) return [];
    if (row.expiresAt !== undefined && row.expiresAt <= now()) {
      await ctx.db.delete(row._id);
      return [];
    }
    return row.valuesJson;
  },
});

export const enqueue = internalMutation({
  args: { threadId: v.string(), entryJson: v.string(), maxSize: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const timestamp = now();
    const row = await getQueueRow(ctx, args.threadId);
    const entries = [...(row?.entriesJson ?? []), args.entryJson].slice(-args.maxSize);
    if (row === null) {
      await ctx.db.insert("chatSdkQueues", {
        threadId: args.threadId,
        entriesJson: entries,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.patch(row._id, { entriesJson: entries, updatedAt: timestamp });
    }
    return entries.length;
  },
});

export const dequeue = internalMutation({
  args: { threadId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await getQueueRow(ctx, args.threadId);
    if (row === null) return null;

    const timestamp = now();
    const freshEntries: string[] = [];
    for (const entryJson of row.entriesJson) {
      try {
        const entry = JSON.parse(entryJson) as { readonly expiresAt?: number };
        if (entry.expiresAt === undefined || entry.expiresAt > timestamp) {
          freshEntries.push(entryJson);
        }
      } catch {
        // Drop malformed queue entries.
      }
    }
    const [next, ...remaining] = freshEntries;
    await ctx.db.patch(row._id, { entriesJson: remaining, updatedAt: timestamp });
    return next ?? null;
  },
});

export const queueDepth = internalMutation({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const row = await getQueueRow(ctx, args.threadId);
    return row?.entriesJson.length ?? 0;
  },
});
