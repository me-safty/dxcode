import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "../pathExpansion.ts";

export class CodexProfileDirectoryError extends Schema.TaggedErrorClass<CodexProfileDirectoryError>()(
  "CodexProfileDirectoryError",
  { path: Schema.String },
) {
  override get message(): string {
    return `Codex profile base path '${this.path}' is not a directory.`;
  }
}

const isFile = Effect.fn("CodexAccountProfiles.isFile")(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const stat = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
  return stat?.type === "File";
});

const isDirectory = Effect.fn("CodexAccountProfiles.isDirectory")(function* (
  directoryPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const stat = yield* fileSystem.stat(directoryPath).pipe(Effect.orElseSucceed(() => null));
  return stat?.type === "Directory";
});

/**
 * Resolve either a CODEX_HOME itself or a Codex Desktop account directory
 * containing a nested `codex-home` directory.
 */
export const resolveCodexProfileHomePath = Effect.fn(
  "CodexAccountProfiles.resolveCodexProfileHomePath",
)(function* (candidatePath: string) {
  const path = yield* Path.Path;
  const resolvedCandidate = path.resolve(expandHomePath(candidatePath));
  if (yield* isFile(path.join(resolvedCandidate, "auth.json"))) {
    return resolvedCandidate;
  }

  const nestedHome = path.join(resolvedCandidate, "codex-home");
  if (yield* isFile(path.join(nestedHome, "auth.json"))) {
    return nestedHome;
  }

  return null;
});

export const scanCodexProfileHomes = Effect.fn("CodexAccountProfiles.scanCodexProfileHomes")(
  function* (basePath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolvedBasePath = path.resolve(expandHomePath(basePath));

    if (!(yield* isDirectory(resolvedBasePath))) {
      return yield* new CodexProfileDirectoryError({ path: resolvedBasePath });
    }

    const baseProfile = yield* resolveCodexProfileHomePath(resolvedBasePath);
    if (baseProfile !== null) {
      return [baseProfile];
    }

    const entries = (yield* fileSystem.readDirectory(resolvedBasePath)).toSorted((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    const profiles: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(resolvedBasePath, entry);
      if (!(yield* isDirectory(entryPath))) continue;
      const profileHome = yield* resolveCodexProfileHomePath(entryPath);
      if (profileHome !== null) profiles.push(profileHome);
    }
    return profiles;
  },
);
