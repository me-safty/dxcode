import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFiles,
  WorkspaceFilesError,
  type WorkspaceFilesShape,
} from "../Services/WorkspaceFiles.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

export const makeWorkspaceFiles = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceEntries = yield* WorkspaceEntries;

  const resolveWriteTarget = Effect.fn("WorkspaceFiles.resolveWriteTarget")(function* (input: {
    cwd: string;
    relativePath: string;
  }): Effect.fn.Return<{ absolutePath: string; relativePath: string }, WorkspaceFilesError> {
    const normalizedInputPath = input.relativePath.trim();
    if (path.isAbsolute(normalizedInputPath)) {
      return yield* new WorkspaceFilesError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFiles.resolveWriteTarget",
        detail: "Workspace file path must be relative to the project root.",
      });
    }

    const absolutePath = path.resolve(input.cwd, normalizedInputPath);
    const relativeToRoot = toPosixRelativePath(path.relative(input.cwd, absolutePath));
    if (
      relativeToRoot.length === 0 ||
      relativeToRoot === "." ||
      relativeToRoot.startsWith("../") ||
      relativeToRoot === ".." ||
      path.isAbsolute(relativeToRoot)
    ) {
      return yield* new WorkspaceFilesError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: "workspaceFiles.resolveWriteTarget",
        detail: "Workspace file path must stay within the project root.",
      });
    }

    return {
      absolutePath,
      relativePath: relativeToRoot,
    };
  });

  const writeFile: WorkspaceFilesShape["writeFile"] = Effect.fn("WorkspaceFiles.writeFile")(
    function* (input) {
      const target = yield* resolveWriteTarget(input);
      yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFilesError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFiles.makeDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );
      yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFilesError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFiles.writeFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
      yield* workspaceEntries.invalidate(input.cwd);
      return { relativePath: target.relativePath };
    },
  );

  return {
    writeFile,
  } satisfies WorkspaceFilesShape;
});

export const WorkspaceFilesLive = Layer.effect(WorkspaceFiles, makeWorkspaceFiles);
