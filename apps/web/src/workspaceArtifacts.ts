import type { WorkLogEntry } from "./session-logic";
import type { TurnDiffSummary } from "./types";

export type WorkspaceArtifactCategory =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "note"
  | "image"
  | "data"
  | "code"
  | "archive"
  | "other";

export interface WorkspaceArtifactDescriptor {
  extension: string | null;
  category: WorkspaceArtifactCategory;
  typeLabel: string;
  previewKind: "text" | "native";
}

export interface WorkspaceArtifact {
  id: string;
  path: string;
  completedAt: string;
  category: WorkspaceArtifactCategory;
  extension: string | null;
  typeLabel: string;
  previewKind: "text" | "native";
  status: string;
  additions: number;
  deletions: number;
  turnId?: TurnDiffSummary["turnId"];
}

const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "pages", "rtf"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "ods", "numbers"]);
const PRESENTATION_EXTENSIONS = new Set(["key", "odp", "ppt", "pptx"]);
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const DATA_EXTENSIONS = new Set(["json", "jsonl", "toml", "xml", "yaml", "yml"]);
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsx",
]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "zip"]);

const CATEGORY_PRIORITY: Record<WorkspaceArtifactCategory, number> = {
  document: 0,
  note: 1,
  presentation: 2,
  spreadsheet: 3,
  pdf: 4,
  image: 5,
  data: 6,
  code: 7,
  archive: 8,
  other: 9,
};

function extensionFromPath(path: string): string | null {
  const normalized = path.trim();
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
  const extensionIndex = basename.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === basename.length - 1) {
    return null;
  }
  return basename.slice(extensionIndex + 1).toLowerCase();
}

function normalizeArtifactStatus(kind: string | undefined, additions: number, deletions: number) {
  switch (kind?.trim().toLowerCase()) {
    case "new":
    case "created":
    case "added":
      return "Created";
    case "deleted":
    case "removed":
      return "Removed";
    case "rename-pure":
    case "rename":
    case "renamed":
      return "Moved";
    case "rename-changed":
      return "Moved and updated";
    case "change":
    case "modified":
    case "updated":
      return "Updated";
    default:
      if (additions > 0 && deletions === 0) return "Created";
      if (deletions > 0 && additions === 0) return "Removed";
      return "Updated";
  }
}

export function describeWorkspaceArtifact(path: string): WorkspaceArtifactDescriptor {
  const extension = extensionFromPath(path);
  if (extension === "md" || extension === "mdx") {
    return {
      extension,
      category: "note",
      typeLabel: "Markdown",
      previewKind: "text",
    };
  }
  if (extension === "pdf") {
    return {
      extension,
      category: "pdf",
      typeLabel: "PDF",
      previewKind: "native",
    };
  }
  if (extension && DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "document",
      typeLabel: "Document",
      previewKind: "native",
    };
  }
  if (extension && SPREADSHEET_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "spreadsheet",
      typeLabel: extension === "csv" || extension === "tsv" ? "Table" : "Spreadsheet",
      previewKind: extension === "csv" || extension === "tsv" ? "text" : "native",
    };
  }
  if (extension && PRESENTATION_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "presentation",
      typeLabel: "Presentation",
      previewKind: "native",
    };
  }
  if (extension && IMAGE_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "image",
      typeLabel: "Image",
      previewKind: "native",
    };
  }
  if (extension && DATA_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "data",
      typeLabel: "Data",
      previewKind: "text",
    };
  }
  if (extension && CODE_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "code",
      typeLabel: "Code",
      previewKind: "text",
    };
  }
  if (extension && ARCHIVE_EXTENSIONS.has(extension)) {
    return {
      extension,
      category: "archive",
      typeLabel: "Archive",
      previewKind: "native",
    };
  }
  if (extension === "txt") {
    return {
      extension,
      category: "document",
      typeLabel: "Text",
      previewKind: "text",
    };
  }
  return {
    extension,
    category: "other",
    typeLabel: extension ? extension.toUpperCase() : "File",
    previewKind: "native",
  };
}

export function deriveWorkspaceArtifacts(input: {
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  workEntries: ReadonlyArray<WorkLogEntry>;
}): WorkspaceArtifact[] {
  const byPath = new Map<string, WorkspaceArtifact>();
  const orderedTurnDiffSummaries = [...input.turnDiffSummaries].toSorted((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  );

  for (const summary of orderedTurnDiffSummaries) {
    for (const file of summary.files) {
      const path = file.path.trim();
      if (path.length === 0 || byPath.has(path)) {
        continue;
      }
      const descriptor = describeWorkspaceArtifact(path);
      const additions = file.additions ?? 0;
      const deletions = file.deletions ?? 0;
      byPath.set(path, {
        id: `artifact:${path}`,
        path,
        completedAt: summary.completedAt,
        category: descriptor.category,
        extension: descriptor.extension,
        typeLabel: descriptor.typeLabel,
        previewKind: descriptor.previewKind,
        status: normalizeArtifactStatus(file.kind, additions, deletions),
        additions,
        deletions,
        turnId: summary.turnId,
      });
    }
  }

  const orderedWorkEntries = [...input.workEntries].toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  for (const entry of orderedWorkEntries) {
    for (const rawPath of entry.changedFiles ?? []) {
      const path = rawPath.trim();
      if (path.length === 0 || byPath.has(path)) {
        continue;
      }
      const descriptor = describeWorkspaceArtifact(path);
      byPath.set(path, {
        id: `artifact:${path}`,
        path,
        completedAt: entry.createdAt,
        category: descriptor.category,
        extension: descriptor.extension,
        typeLabel: descriptor.typeLabel,
        previewKind: descriptor.previewKind,
        status: "Updated",
        additions: 0,
        deletions: 0,
      });
    }
  }

  return [...byPath.values()].toSorted((left, right) => {
    const categoryPriority = CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category];
    if (categoryPriority !== 0) {
      return categoryPriority;
    }
    const timestampComparison = right.completedAt.localeCompare(left.completedAt);
    if (timestampComparison !== 0) {
      return timestampComparison;
    }
    return left.path.localeCompare(right.path, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function selectRecentArtifactOutputs(
  artifacts: ReadonlyArray<WorkspaceArtifact>,
  limit = 6,
): WorkspaceArtifact[] {
  return [...artifacts]
    .toSorted((left, right) => {
      const timestampComparison = right.completedAt.localeCompare(left.completedAt);
      if (timestampComparison !== 0) {
        return timestampComparison;
      }
      const categoryPriority = CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category];
      if (categoryPriority !== 0) {
        return categoryPriority;
      }
      return left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, Math.max(0, limit));
}
