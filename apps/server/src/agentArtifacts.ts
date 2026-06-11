// @effect-diagnostics nodeBuiltinImport:off
import NodePath from "node:path";

import {
  type ChatAttachment,
  PROVIDER_GENERATED_ATTACHMENT_MAX_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";

import {
  createAttachmentId,
  resolveAttachmentPath,
  toSafeThreadAttachmentSegment,
} from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";

export const AGENT_ARTIFACTS_ENV_VAR = "T3_ARTIFACTS_DIR";
export const AGENT_ARTIFACTS_MANIFEST_FILE = "attachments.json";
export const AGENT_ARTIFACT_INSTRUCTIONS = `<agent_artifacts>
When you create files intended for the user to download or view, write them inside the directory named by the ${AGENT_ARTIFACTS_ENV_VAR} environment variable. Then create or update ${AGENT_ARTIFACTS_MANIFEST_FILE} in that directory with JSON in this shape: {"attachments":[{"path":"relative/path.ext","name":"display-name.ext","mimeType":"type/subtype"}]}. Use paths relative to ${AGENT_ARTIFACTS_ENV_VAR}; list only files that are intentionally meant for the user.
</agent_artifacts>`;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

interface AgentArtifactManifestEntry {
  readonly path: string;
  readonly name?: string;
  readonly mimeType?: string;
}

class AgentArtifactManifestParseError extends Data.TaggedError("AgentArtifactManifestParseError")<{
  readonly cause: unknown;
}> {}

export function agentArtifactsRootDir(stateDir: string): string {
  return NodePath.join(stateDir, "agent-artifacts");
}

export function appendAgentArtifactInstructions(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return text;
  }
  return `${trimmed}\n\n${AGENT_ARTIFACT_INSTRUCTIONS}`;
}

export function agentArtifactsDirForThread(input: {
  readonly stateDir: string;
  readonly threadId: ThreadId | string;
}): string {
  const threadSegment = toSafeThreadAttachmentSegment(String(input.threadId)) ?? "thread";
  return NodePath.join(agentArtifactsRootDir(input.stateDir), threadSegment);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifestEntries(raw: string): ReadonlyArray<AgentArtifactManifestEntry> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.attachments)) {
    return [];
  }
  return parsed.attachments.flatMap((entry): AgentArtifactManifestEntry[] => {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.path.trim().length === 0) {
      return [];
    }
    return [
      {
        path: entry.path,
        ...(typeof entry.name === "string" && entry.name.trim().length > 0
          ? { name: entry.name }
          : {}),
        ...(typeof entry.mimeType === "string" && entry.mimeType.trim().length > 0
          ? { mimeType: entry.mimeType }
          : {}),
      },
    ];
  });
}

function parseManifestEntriesEffect(raw: string) {
  return Effect.try({
    try: () => parseManifestEntries(raw),
    catch: (cause) => new AgentArtifactManifestParseError({ cause }),
  });
}

function safeDisplayName(entry: AgentArtifactManifestEntry): string {
  const raw = (entry.name ?? NodePath.basename(entry.path)).trim();
  const withoutSeparators = NodePath.basename(raw).trim();
  const name = withoutSeparators.length > 0 ? withoutSeparators : "attachment";
  return name.length <= 255 ? name : name.slice(0, 255);
}

function inferMimeType(entry: AgentArtifactManifestEntry): string {
  const rawMimeType = entry.mimeType?.trim().toLowerCase();
  if (
    rawMimeType &&
    rawMimeType.length <= 100 &&
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(rawMimeType)
  ) {
    return rawMimeType;
  }

  const extension = NodePath.extname(entry.name ?? entry.path).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function resolveArtifactPath(input: {
  readonly artifactsDir: string;
  readonly relativePath: string;
}): string | null {
  if (NodePath.isAbsolute(input.relativePath)) {
    return null;
  }

  const root = NodePath.resolve(input.artifactsDir);
  const candidate = NodePath.resolve(root, input.relativePath);
  const relative = NodePath.relative(root, candidate);
  if (relative.length === 0 || relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

export const materializeAgentArtifactManifest = (input: {
  readonly threadId: ThreadId;
}): Effect.Effect<ReadonlyArray<ChatAttachment>, never, FileSystem.FileSystem | ServerConfig> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const artifactsDir = agentArtifactsDirForThread({
      stateDir: serverConfig.stateDir,
      threadId: input.threadId,
    });
    const manifestPath = NodePath.join(artifactsDir, AGENT_ARTIFACTS_MANIFEST_FILE);
    const rawManifest = yield* fileSystem
      .readFileString(manifestPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (rawManifest === null) {
      return [] as const;
    }

    const entries = yield* parseManifestEntriesEffect(rawManifest).pipe(
      Effect.catchTag("AgentArtifactManifestParseError", (error) =>
        Effect.logWarning("agent artifact manifest could not be parsed", {
          threadId: String(input.threadId),
          manifestPath,
          cause: error.cause instanceof Error ? error.cause.message : String(error.cause),
        }).pipe(Effect.as([] as ReadonlyArray<AgentArtifactManifestEntry>)),
      ),
    );

    const attachments = yield* Effect.forEach(
      entries.slice(0, 8),
      (entry) =>
        Effect.gen(function* () {
          const sourcePath = resolveArtifactPath({
            artifactsDir,
            relativePath: entry.path,
          });
          if (!sourcePath) {
            yield* Effect.logWarning("agent artifact manifest entry escaped artifact directory", {
              threadId: String(input.threadId),
              path: entry.path,
            });
            return null;
          }

          const fileInfo = yield* fileSystem
            .stat(sourcePath)
            .pipe(Effect.orElseSucceed(() => null));
          if (!fileInfo || fileInfo.type !== "File") {
            yield* Effect.logWarning("agent artifact manifest entry was not a file", {
              threadId: String(input.threadId),
              path: entry.path,
            });
            return null;
          }

          const sizeBytes = Number(fileInfo.size);
          if (
            !Number.isFinite(sizeBytes) ||
            sizeBytes <= 0 ||
            sizeBytes > PROVIDER_GENERATED_ATTACHMENT_MAX_BYTES
          ) {
            yield* Effect.logWarning("agent artifact manifest entry had invalid size", {
              threadId: String(input.threadId),
              path: entry.path,
              sizeBytes,
            });
            return null;
          }

          const attachmentId = createAttachmentId(String(input.threadId));
          if (!attachmentId) {
            yield* Effect.logWarning("agent artifact attachment id could not be created", {
              threadId: String(input.threadId),
            });
            return null;
          }

          const mimeType = inferMimeType(entry);
          const persistedAttachment: ChatAttachment =
            mimeType.startsWith("image/") && sizeBytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
              ? {
                  type: "image",
                  id: attachmentId,
                  name: safeDisplayName(entry),
                  mimeType,
                  sizeBytes,
                }
              : {
                  type: "file",
                  id: attachmentId,
                  name: safeDisplayName(entry),
                  mimeType,
                  sizeBytes,
                };
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            yield* Effect.logWarning("agent artifact attachment path could not be resolved", {
              threadId: String(input.threadId),
              attachmentId,
            });
            return null;
          }

          const bytes = yield* fileSystem
            .readFile(sourcePath)
            .pipe(Effect.orElseSucceed(() => null));
          if (bytes === null) {
            yield* Effect.logWarning("agent artifact file could not be read", {
              threadId: String(input.threadId),
              sourcePath,
            });
            return null;
          }

          yield* fileSystem.makeDirectory(NodePath.dirname(attachmentPath), { recursive: true });
          yield* fileSystem.writeFile(attachmentPath, bytes);

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    yield* fileSystem.remove(manifestPath, { force: true }).pipe(Effect.ignore);

    return attachments.filter((attachment): attachment is ChatAttachment => attachment !== null);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent artifact manifest ingestion failed", {
        threadId: String(input.threadId),
        cause: Cause.pretty(cause),
      }).pipe(Effect.as([] as ReadonlyArray<ChatAttachment>)),
    ),
  );

export const ensureAgentArtifactsDir = (input: {
  readonly threadId: ThreadId | string;
}): Effect.Effect<string, never, FileSystem.FileSystem | ServerConfig> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const artifactsDir = agentArtifactsDirForThread({
      stateDir: serverConfig.stateDir,
      threadId: input.threadId,
    });
    yield* fileSystem
      .makeDirectory(artifactsDir, { recursive: true })
      .pipe(Effect.catch(() => Effect.void));
    return artifactsDir;
  });
