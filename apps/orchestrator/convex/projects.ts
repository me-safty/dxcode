import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";

const projectFields = {
  repoName: v.string(),
  sandboxWorkspaceRoot: v.string(),
  defaultBranch: v.string(),
  githubOwner: v.string(),
  githubRepo: v.string(),
  sandboxProvider: v.optional(v.union(v.literal("local"), v.literal("modal"))),
  modalAppName: v.optional(v.string()),
  modalEnvironment: v.optional(v.string()),
  modalImageTag: v.optional(v.string()),
  modalCpu: v.optional(v.number()),
  modalCpuLimit: v.optional(v.number()),
  modalMemoryMiB: v.optional(v.number()),
  modalMemoryLimitMiB: v.optional(v.number()),
  modalTimeoutMs: v.optional(v.number()),
  modalIdleTimeoutMs: v.optional(v.number()),
  modalAllowedSecretNamesJson: v.optional(v.string()),
  linearTeamId: v.optional(v.string()),
  linearProjectId: v.optional(v.string()),
  t3ProjectId: v.optional(v.string()),
} as const;

function projectReturn() {
  return v.object({
    id: v.id("projects"),
    repoName: v.string(),
    sandboxWorkspaceRoot: v.string(),
    defaultBranch: v.string(),
    githubOwner: v.string(),
    githubRepo: v.string(),
    sandboxProvider: v.optional(v.union(v.literal("local"), v.literal("modal"))),
    modalAppName: v.optional(v.string()),
    modalEnvironment: v.optional(v.string()),
    modalImageTag: v.optional(v.string()),
    modalCpu: v.optional(v.number()),
    modalCpuLimit: v.optional(v.number()),
    modalMemoryMiB: v.optional(v.number()),
    modalMemoryLimitMiB: v.optional(v.number()),
    modalTimeoutMs: v.optional(v.number()),
    modalIdleTimeoutMs: v.optional(v.number()),
    modalAllowedSecretNamesJson: v.optional(v.string()),
    linearTeamId: v.optional(v.string()),
    linearProjectId: v.optional(v.string()),
    t3ProjectId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  });
}

function toProject(row: any) {
  return {
    id: row._id,
    repoName: row.repoName,
    sandboxWorkspaceRoot: row.sandboxWorkspaceRoot,
    defaultBranch: row.defaultBranch,
    githubOwner: row.githubOwner,
    githubRepo: row.githubRepo,
    ...(row.sandboxProvider !== undefined ? { sandboxProvider: row.sandboxProvider } : {}),
    ...(row.modalAppName !== undefined ? { modalAppName: row.modalAppName } : {}),
    ...(row.modalEnvironment !== undefined ? { modalEnvironment: row.modalEnvironment } : {}),
    ...(row.modalImageTag !== undefined ? { modalImageTag: row.modalImageTag } : {}),
    ...(row.modalCpu !== undefined ? { modalCpu: row.modalCpu } : {}),
    ...(row.modalCpuLimit !== undefined ? { modalCpuLimit: row.modalCpuLimit } : {}),
    ...(row.modalMemoryMiB !== undefined ? { modalMemoryMiB: row.modalMemoryMiB } : {}),
    ...(row.modalMemoryLimitMiB !== undefined
      ? { modalMemoryLimitMiB: row.modalMemoryLimitMiB }
      : {}),
    ...(row.modalTimeoutMs !== undefined ? { modalTimeoutMs: row.modalTimeoutMs } : {}),
    ...(row.modalIdleTimeoutMs !== undefined ? { modalIdleTimeoutMs: row.modalIdleTimeoutMs } : {}),
    ...(row.modalAllowedSecretNamesJson !== undefined
      ? { modalAllowedSecretNamesJson: row.modalAllowedSecretNamesJson }
      : {}),
    ...(row.linearTeamId !== undefined ? { linearTeamId: row.linearTeamId } : {}),
    ...(row.linearProjectId !== undefined ? { linearProjectId: row.linearProjectId } : {}),
    ...(row.t3ProjectId !== undefined ? { t3ProjectId: row.t3ProjectId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const upsertProject = mutation({
  args: projectFields,
  returns: projectReturn(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_repo", (q: any) =>
        q.eq("githubOwner", args.githubOwner).eq("githubRepo", args.githubRepo),
      )
      .unique();

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        repoName: args.repoName,
        sandboxWorkspaceRoot: args.sandboxWorkspaceRoot,
        defaultBranch: args.defaultBranch,
        ...(args.sandboxProvider !== undefined ? { sandboxProvider: args.sandboxProvider } : {}),
        ...(args.modalAppName !== undefined ? { modalAppName: args.modalAppName } : {}),
        ...(args.modalEnvironment !== undefined ? { modalEnvironment: args.modalEnvironment } : {}),
        ...(args.modalImageTag !== undefined ? { modalImageTag: args.modalImageTag } : {}),
        ...(args.modalCpu !== undefined ? { modalCpu: args.modalCpu } : {}),
        ...(args.modalCpuLimit !== undefined ? { modalCpuLimit: args.modalCpuLimit } : {}),
        ...(args.modalMemoryMiB !== undefined ? { modalMemoryMiB: args.modalMemoryMiB } : {}),
        ...(args.modalMemoryLimitMiB !== undefined
          ? { modalMemoryLimitMiB: args.modalMemoryLimitMiB }
          : {}),
        ...(args.modalTimeoutMs !== undefined ? { modalTimeoutMs: args.modalTimeoutMs } : {}),
        ...(args.modalIdleTimeoutMs !== undefined
          ? { modalIdleTimeoutMs: args.modalIdleTimeoutMs }
          : {}),
        ...(args.modalAllowedSecretNamesJson !== undefined
          ? { modalAllowedSecretNamesJson: args.modalAllowedSecretNamesJson }
          : {}),
        updatedAt: now,
        ...(args.linearTeamId !== undefined ? { linearTeamId: args.linearTeamId } : {}),
        ...(args.linearProjectId !== undefined ? { linearProjectId: args.linearProjectId } : {}),
        ...(args.t3ProjectId !== undefined ? { t3ProjectId: args.t3ProjectId } : {}),
      });
      const updated = await ctx.db.get(existing._id);
      return toProject(updated);
    }

    const projectId = await ctx.db.insert("projects", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(projectId);
    return toProject(created);
  },
});

export const listProjects = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(projectReturn()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("projects").take(args.limit ?? 100);
    return rows.map(toProject);
  },
});

export const getProjectByRepo = query({
  args: {
    githubOwner: v.string(),
    githubRepo: v.string(),
  },
  returns: v.union(v.null(), projectReturn()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_repo", (q: any) =>
        q.eq("githubOwner", args.githubOwner).eq("githubRepo", args.githubRepo),
      )
      .unique();
    return row === null ? null : toProject(row);
  },
});
