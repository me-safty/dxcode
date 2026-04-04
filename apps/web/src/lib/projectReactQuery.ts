import type { ProjectListSkillsResult, ProjectSearchEntriesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
  listSkills: (cwd: string | null) => ["projects", "skills", cwd] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

const SKILLS_STALE_TIME = 60_000;
const EMPTY_SKILLS_RESULT: ProjectListSkillsResult = { skills: [] };

export function projectListSkillsQueryOptions(input: { cwd: string | null }) {
  return queryOptions({
    queryKey: projectQueryKeys.listSkills(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Skill listing is unavailable without a project.");
      }
      return api.projects.listSkills({ cwd: input.cwd });
    },
    enabled: input.cwd !== null,
    staleTime: SKILLS_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SKILLS_RESULT,
  });
}
