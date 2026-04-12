export interface WorkspaceRouteSearch extends Record<string, unknown> {
  panel?: string | undefined;
}

export function normalizeWorkspaceRouteSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripWorkspaceRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
  keys: readonly string[],
): T {
  const next = { ...params };

  for (const key of keys) {
    delete next[key];
  }

  return next;
}

export function parseWorkspaceRouteSearch(search: Record<string, unknown>): WorkspaceRouteSearch {
  const next: WorkspaceRouteSearch = { ...search };
  const panel = normalizeWorkspaceRouteSearchString(search.panel);

  if (panel) {
    next.panel = panel;
  } else {
    delete next.panel;
  }

  return next;
}
