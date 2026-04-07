import {
  CodeRabbitFindingId,
  type CodeRabbitFinding,
  type CodeRabbitFindingSeverity,
  type CodeRabbitReviewPhase,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";

const FINDING_ID_SPEC_VERSION = "coderabbit-finding-v1";
const FINDING_ID_SALT = "t3code";
const GENERIC_REVIEW_PRELUDE =
  "verify each finding against the current code and only fix it if needed.";

type RawJsonObject = Record<string, unknown>;

export type ParsedCodeRabbitCliLine =
  | {
      readonly kind: "review_context";
      readonly currentBranch: string | null;
      readonly baseBranch: string | null;
      readonly workingDirectory: string | null;
    }
  | {
      readonly kind: "status";
      readonly phase: CodeRabbitReviewPhase;
      readonly statusText: string | null;
    }
  | {
      readonly kind: "finding";
      readonly finding: Omit<CodeRabbitFinding, "createdAt">;
    }
  | {
      readonly kind: "complete";
      readonly statusText: string | null;
    }
  | {
      readonly kind: "error";
      readonly message: string;
    }
  | {
      readonly kind: "unknown";
      readonly rawType: string | null;
    };

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSeverity(value: unknown): CodeRabbitFindingSeverity {
  switch (asNonEmptyString(value)?.toLowerCase()) {
    case "info":
    case "trivial":
    case "minor":
    case "major":
    case "critical":
      return asNonEmptyString(value)!.toLowerCase() as CodeRabbitFindingSeverity;
    default:
      return "minor";
  }
}

function normalizeSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        const normalized = entry.trim();
        return normalized.length > 0 ? [normalized] : [];
      }

      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        for (const key of ["text", "summary", "title", "description", "body"]) {
          const normalized = asNonEmptyString(record[key]);
          if (normalized) {
            return [normalized];
          }
        }
      }

      return [];
    })
    .slice(0, 20);
}

export function summarizeCodeRabbitInstructions(codegenInstructions: string): string {
  const paragraphs = codegenInstructions
    .split(/\n\s*\n/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const preferred =
    paragraphs.find((entry) => entry.toLowerCase() !== GENERIC_REVIEW_PRELUDE) ??
    paragraphs[0] ??
    "CodeRabbit finding";
  return preferred.replace(/\s+/g, " ").trim();
}

function buildFindingLocationKey(finding: Pick<CodeRabbitFinding, "location">): string {
  if (finding.location.type === "file") {
    return `file:${finding.location.filePath}`;
  }
  const range = finding.location.lineRange;
  return [
    "line",
    finding.location.filePath,
    String(finding.location.lineNumber),
    range ? `${range.start}-${range.end}` : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(":");
}

export function createCodeRabbitFindingId(
  finding: Pick<
    CodeRabbitFinding,
    "severity" | "summary" | "filePath" | "location" | "codegenInstructions"
  >,
) {
  const canonical = JSON.stringify({
    specVersion: FINDING_ID_SPEC_VERSION,
    salt: FINDING_ID_SALT,
    severity: finding.severity,
    filePath: finding.filePath,
    location: buildFindingLocationKey(finding),
    summary: finding.summary.replace(/\s+/g, " ").trim(),
    codegenInstructions: finding.codegenInstructions.replace(/\s+/g, " ").trim(),
  });
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 20);
  return CodeRabbitFindingId.makeUnsafe(`crf_${digest}`);
}

export function mapCodeRabbitStatusPhase(rawPhase: string | null): CodeRabbitReviewPhase {
  switch (rawPhase) {
    case "connecting":
      return "connecting";
    case "setup":
      return "setup";
    case "analyzing":
      return "analyzing";
    default:
      return "starting";
  }
}

export function parseCodeRabbitAuthStatusOutput(output: string): {
  readonly authenticated: boolean;
  readonly rawStatus: string | null;
} {
  const lines = output
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RawJsonObject;
      if (parsed.type === "status" && parsed.phase === "auth") {
        return {
          authenticated: parsed.authenticated === true || parsed.status === "authenticated",
          rawStatus: asNonEmptyString(parsed.status),
        };
      }
    } catch {
      // ignore non-JSON auth status output
    }
  }

  return {
    authenticated: false,
    rawStatus: null,
  };
}

function parseCodeRabbitFinding(raw: RawJsonObject): ParsedCodeRabbitCliLine | null {
  const filePath = asNonEmptyString(raw.fileName) ?? asNonEmptyString(raw.filePath);
  const codegenInstructions = asNonEmptyString(raw.codegenInstructions);
  if (!filePath || !codegenInstructions) {
    return null;
  }

  const normalizedSeverity = normalizeSeverity(raw.severity);
  const summary = summarizeCodeRabbitInstructions(codegenInstructions);
  const finding = {
    id: createCodeRabbitFindingId({
      severity: normalizedSeverity,
      summary,
      filePath,
      location: {
        type: "file" as const,
        filePath,
      },
      codegenInstructions,
    }),
    severity: normalizedSeverity,
    summary,
    filePath,
    location: {
      type: "file" as const,
      filePath,
    },
    codegenInstructions,
    suggestions: normalizeSuggestions(raw.suggestions),
    sourceEventType: "finding",
  } satisfies Omit<CodeRabbitFinding, "createdAt">;

  return {
    kind: "finding",
    finding,
  };
}

export function parseCodeRabbitCliLine(line: string): ParsedCodeRabbitCliLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let raw: RawJsonObject;
  try {
    raw = JSON.parse(trimmed) as RawJsonObject;
  } catch {
    return null;
  }

  const rawType = asNonEmptyString(raw.type);
  switch (rawType) {
    case "review_context":
      return {
        kind: "review_context",
        currentBranch: asNonEmptyString(raw.currentBranch),
        baseBranch: asNonEmptyString(raw.baseBranch),
        workingDirectory: asNonEmptyString(raw.workingDirectory),
      };
    case "status":
      return {
        kind: "status",
        phase: mapCodeRabbitStatusPhase(asNonEmptyString(raw.phase)),
        statusText: asNonEmptyString(raw.status),
      };
    case "finding":
      return parseCodeRabbitFinding(raw);
    case "complete":
      return {
        kind: "complete",
        statusText: asNonEmptyString(raw.status),
      };
    case "error":
      return {
        kind: "error",
        message:
          asNonEmptyString(raw.message) ??
          asNonEmptyString(raw.error) ??
          "CodeRabbit review failed.",
      };
    default:
      return {
        kind: "unknown",
        rawType,
      };
  }
}
