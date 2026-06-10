import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

/** Largest file we will decode and return as editable text (bytes). */
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
/** Bytes inspected when sniffing for binary content. */
const BINARY_SNIFF_BYTES = 8000;

function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    // A NUL byte is the strongest signal that the payload is not UTF-8 text.
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const textDecoder = new TextDecoder("utf-8");

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const mapFsError = (operation: string) => (cause: { readonly message: string }) =>
        new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation,
          detail: cause.message,
          cause,
        });

      const stat = yield* fileSystem
        .stat(target.absolutePath)
        .pipe(Effect.mapError(mapFsError("workspaceFileSystem.stat")));
      const byteSize = Number(stat.size);

      if (byteSize > MAX_TEXT_FILE_BYTES) {
        return {
          relativePath: target.relativePath,
          contents: "",
          binary: true,
          byteSize,
        };
      }

      const bytes = yield* fileSystem
        .readFile(target.absolutePath)
        .pipe(Effect.mapError(mapFsError("workspaceFileSystem.readFile")));

      if (looksBinary(bytes)) {
        return {
          relativePath: target.relativePath,
          contents: "",
          binary: true,
          byteSize,
        };
      }

      return {
        relativePath: target.relativePath,
        contents: textDecoder.decode(bytes),
        binary: false,
        byteSize,
      };
    },
  );

  const listTree: WorkspaceFileSystemShape["listTree"] = Effect.fn("WorkspaceFileSystem.listTree")(
    function* (input) {
      const requested = input.relativePath?.trim();
      const atRoot = requested === undefined || requested.length === 0 || requested === ".";

      // The root itself is rejected by resolveRelativePathWithinRoot (it only
      // accepts strict descendants), so resolve it via normalizeWorkspaceRoot.
      const directory = atRoot
        ? {
            absolutePath: yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
              Effect.mapError(
                (cause) =>
                  new WorkspaceFileSystemError({
                    cwd: input.cwd,
                    operation: "workspaceFileSystem.normalizeWorkspaceRoot",
                    detail: cause.message,
                    cause,
                  }),
              ),
            ),
            relativePath: "",
          }
        : yield* workspacePaths.resolveRelativePathWithinRoot({
            workspaceRoot: input.cwd,
            relativePath: requested,
          });

      const names = yield* fileSystem.readDirectory(directory.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: directory.relativePath,
              operation: "workspaceFileSystem.readDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );

      const entries = yield* Effect.forEach(
        names,
        (name) =>
          fileSystem.stat(path.join(directory.absolutePath, name)).pipe(
            Effect.map((stat) => {
              const kind = stat.type === "Directory" ? ("directory" as const) : ("file" as const);
              const childRelative =
                directory.relativePath.length === 0 ? name : `${directory.relativePath}/${name}`;
              return { name, path: childRelative, kind };
            }),
            // Entries we cannot stat (broken symlinks, races) are simply skipped.
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 16 },
      );

      const visible = entries.filter(
        (entry): entry is { name: string; path: string; kind: "file" | "directory" } =>
          entry !== null,
      );
      // Directories first, then files; each group sorted case-insensitively.
      visible.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      return {
        relativePath: directory.relativePath,
        entries: visible,
      };
    },
  );

  return { writeFile, readFile, listTree } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
