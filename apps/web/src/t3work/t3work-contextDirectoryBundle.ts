export type T3WorkDirectoryBundleFile = {
  relativePath: string;
  contents: string;
  encoding?: "base64";
  sizeBytes?: number;
};

export type T3WorkDirectoryBundleReference = {
  label: string;
  relativePath: string;
};

export type T3WorkDirectoryBundlePayload = {
  kind: "t3work-directory-bundle";
  dedupeKey: string;
  bundleRootRelativePath: string;
  files: ReadonlyArray<T3WorkDirectoryBundleFile>;
  fileReferences: ReadonlyArray<T3WorkDirectoryBundleReference>;
  lightweightItem: unknown;
};

export function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function dedupeDirectoryBundleFiles(
  files: ReadonlyArray<T3WorkDirectoryBundleFile>,
): T3WorkDirectoryBundleFile[] {
  const byRelativePath = new Map<string, T3WorkDirectoryBundleFile>();
  for (const file of files) {
    byRelativePath.set(file.relativePath, file);
  }
  return [...byRelativePath.values()].toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function dedupeDirectoryBundleReferences(
  references: ReadonlyArray<T3WorkDirectoryBundleReference>,
): T3WorkDirectoryBundleReference[] {
  const seen = new Set<string>();
  const next: T3WorkDirectoryBundleReference[] = [];
  for (const reference of references) {
    const key = `${reference.label}:${reference.relativePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(reference);
  }
  return next;
}
