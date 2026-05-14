import { v } from "convex/values";
import * as DateTime from "effect/DateTime";

import { internalMutation, query } from "./_generated/server.js";

const severity = v.union(
  v.literal("debug"),
  v.literal("info"),
  v.literal("warn"),
  v.literal("error"),
);

function eventReturn() {
  return v.object({
    id: v.id("orchestratorEvents"),
    eventKey: v.optional(v.string()),
    kind: v.string(),
    source: v.string(),
    severity,
    summary: v.string(),
    taskId: v.optional(v.id("tasks")),
    workSessionId: v.optional(v.id("workSessions")),
    externalId: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    createdAt: v.number(),
  });
}

function toEvent(row: any) {
  return {
    id: row._id,
    ...(row.eventKey !== undefined ? { eventKey: row.eventKey } : {}),
    kind: row.kind,
    source: row.source,
    severity: row.severity,
    summary: row.summary,
    ...(row.taskId !== undefined ? { taskId: row.taskId } : {}),
    ...(row.workSessionId !== undefined ? { workSessionId: row.workSessionId } : {}),
    ...(row.externalId !== undefined ? { externalId: row.externalId } : {}),
    ...(row.payloadJson !== undefined ? { payloadJson: row.payloadJson } : {}),
    createdAt: row.createdAt,
  };
}

export const append = internalMutation({
  args: {
    eventKey: v.optional(v.string()),
    kind: v.string(),
    source: v.string(),
    severity,
    summary: v.string(),
    taskId: v.optional(v.id("tasks")),
    workSessionId: v.optional(v.id("workSessions")),
    externalId: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: eventReturn(),
  handler: async (ctx, args) => {
    if (args.eventKey !== undefined) {
      const existing = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_event_key", (q: any) => q.eq("eventKey", args.eventKey))
        .unique();
      if (existing !== null) {
        return toEvent(existing);
      }
    }

    const eventId = await ctx.db.insert("orchestratorEvents", {
      ...(args.eventKey !== undefined ? { eventKey: args.eventKey } : {}),
      kind: args.kind,
      source: args.source,
      severity: args.severity,
      summary: args.summary,
      ...(args.taskId !== undefined ? { taskId: args.taskId } : {}),
      ...(args.workSessionId !== undefined ? { workSessionId: args.workSessionId } : {}),
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
      ...(args.payloadJson !== undefined ? { payloadJson: args.payloadJson } : {}),
      createdAt: args.createdAt ?? DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });
    const event = await ctx.db.get(eventId);
    return toEvent(event);
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    kind: v.optional(v.string()),
    source: v.optional(v.string()),
    severity: v.optional(severity),
    taskId: v.optional(v.id("tasks")),
    workSessionId: v.optional(v.id("workSessions")),
    externalId: v.optional(v.string()),
  },
  returns: v.array(eventReturn()),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const matchesSecondaryFilters = (row: {
      readonly kind: string;
      readonly source: string;
      readonly severity: "debug" | "info" | "warn" | "error";
      readonly taskId?: unknown;
      readonly workSessionId?: unknown;
      readonly externalId?: string;
    }) => {
      if (args.kind !== undefined && row.kind !== args.kind) return false;
      if (args.source !== undefined && row.source !== args.source) return false;
      if (args.severity !== undefined && row.severity !== args.severity) return false;
      if (args.taskId !== undefined && String(row.taskId) !== String(args.taskId)) return false;
      if (
        args.workSessionId !== undefined &&
        String(row.workSessionId) !== String(args.workSessionId)
      ) {
        return false;
      }
      if (args.externalId !== undefined && row.externalId !== args.externalId) return false;
      return true;
    };

    if (args.taskId !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_task_created", (q: any) => q.eq("taskId", args.taskId))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    if (args.workSessionId !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_work_session_created", (q: any) => q.eq("workSessionId", args.workSessionId))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    if (args.externalId !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_external_created", (q: any) => q.eq("externalId", args.externalId))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    if (args.kind !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_kind_created", (q: any) => q.eq("kind", args.kind))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    if (args.source !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_source_created", (q: any) => q.eq("source", args.source))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    if (args.severity !== undefined) {
      const rows = await ctx.db
        .query("orchestratorEvents")
        .withIndex("by_severity_created", (q: any) => q.eq("severity", args.severity))
        .order("desc")
        .take(limit * 3);
      return rows.filter(matchesSecondaryFilters).slice(0, limit).map(toEvent);
    }

    const rows = await ctx.db
      .query("orchestratorEvents")
      .withIndex("by_created")
      .order("desc")
      .take(limit);
    return rows.map(toEvent);
  },
});
