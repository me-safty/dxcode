export interface FilesRouteSearch {
  files?: "1" | undefined;
  filesPath?: string | undefined;
}

function isFilesOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripFilesSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "files" | "filesPath"> {
  const { files: _files, filesPath: _filesPath, ...rest } = params;
  return rest as Omit<T, "files" | "filesPath">;
}

export function parseFilesRouteSearch(search: Record<string, unknown>): FilesRouteSearch {
  const files = isFilesOpenValue(search.files) ? "1" : undefined;
  const filesPath = files ? normalizeSearchString(search.filesPath) : undefined;

  return {
    ...(files ? { files } : {}),
    ...(filesPath ? { filesPath } : {}),
  };
}
