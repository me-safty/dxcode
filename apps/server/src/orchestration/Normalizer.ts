import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  type ClientOrchestrationCommand,
  type ChatFileAttachment,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@t3tools/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { WorkspacePaths } from "../workspace/Services/WorkspacePaths.ts";

function toSafeFileName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 255);
}

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (command.type === "project.create") {
      const requestedWorkspaceRoot =
        command.kind === "section"
          ? path.join(serverConfig.sectionsDir, command.projectId)
          : command.workspaceRoot;
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          requestedWorkspaceRoot,
          command.kind === "section" ? true : command.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing:
          command.kind === "section" || command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (command.type !== "thread.turn.start") {
      return command as OrchestrationCommand;
    }

    const thread = yield* projectionSnapshotQuery
      .getThreadDetailById(command.threadId)
      .pipe(Effect.map(Option.getOrNull));
    const project = thread
      ? yield* projectionSnapshotQuery
          .getProjectShellById(thread.projectId)
          .pipe(Effect.map(Option.getOrNull))
      : null;
    const workspaceRoot = project?.workspaceRoot ?? null;

    const normalizedAttachments = yield* Effect.forEach(
      command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          if (attachment.type === "image") {
            const parsed = parseBase64DataUrl(attachment.dataUrl);
            if (!parsed || !parsed.mimeType.startsWith("image/")) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Invalid image attachment payload for '${attachment.name}'.`,
              });
            }

            const bytes = Buffer.from(parsed.base64, "base64");
            if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Image attachment '${attachment.name}' is empty or too large.`,
              });
            }

            const attachmentId = createAttachmentId(command.threadId);
            if (!attachmentId) {
              return yield* new OrchestrationDispatchCommandError({
                message: "Failed to create a safe attachment id.",
              });
            }

            const persistedAttachment = {
              type: "image" as const,
              id: attachmentId,
              name: attachment.name,
              mimeType: parsed.mimeType.toLowerCase(),
              sizeBytes: bytes.byteLength,
            };

            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment: persistedAttachment,
            });
            if (!attachmentPath) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Failed to resolve persisted path for '${attachment.name}'.`,
              });
            }

            yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to create attachment directory for '${attachment.name}'.`,
                  }),
              ),
            );
            yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to persist attachment '${attachment.name}'.`,
                  }),
              ),
            );

            return persistedAttachment;
          }

          // file attachment
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid file attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
            return yield* new OrchestrationDispatchCommandError({
              message: `File attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(command.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          if (!workspaceRoot) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Cannot persist file attachment '${attachment.name}': workspace root not found for thread '${command.threadId}'.`,
            });
          }

          const safeFileName = toSafeFileName(attachment.name);
          const relativeUploadPath = path.join(
            ".morecode",
            "uploads",
            command.threadId,
            `${attachmentId}-${safeFileName}`,
          );
          const resolved = yield* workspacePaths
            .resolveRelativePathWithinRoot({
              workspaceRoot,
              relativePath: relativeUploadPath,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationDispatchCommandError({
                    message: `Invalid workspace upload path for '${attachment.name}': ${cause.message}`,
                  }),
              ),
            );

          yield* fileSystem
            .makeDirectory(path.dirname(resolved.absolutePath), { recursive: true })
            .pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to create upload directory for '${attachment.name}'.`,
                  }),
              ),
            );
          yield* fileSystem.writeFile(resolved.absolutePath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist file attachment '${attachment.name}'.`,
                }),
            ),
          );

          const persistedAttachment: ChatFileAttachment = {
            type: "file",
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
            workspacePath: resolved.relativePath,
          };

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...command,
      message: {
        ...command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });
