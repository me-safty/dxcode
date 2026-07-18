import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

export interface VcsRepositoryWatcher {
  readonly changes: (cwd: string) => Stream.Stream<VcsRepositoryChange, never>;
}

export interface VcsRepositoryChange {
  readonly source: "native" | "poll";
}

interface RepositoryWatchPaths {
  readonly rootPath: string;
  readonly metadataPaths: ReadonlyArray<string>;
}

const WATCH_FAILURE_POLL_INTERVAL = "2 seconds";

const normalizeWatchPath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");

export function isRelevantWorktreeWatchPath(value: string): boolean {
  const path = normalizeWatchPath(value);
  return path !== ".git" && !path.startsWith(".git/");
}

export function isRelevantGitMetadataWatchPath(value: string): boolean {
  const path = normalizeWatchPath(value);
  return (
    path === "HEAD" ||
    path === "index" ||
    path === "packed-refs" ||
    path === "config" ||
    path.startsWith("refs/") ||
    path.startsWith("worktrees/")
  );
}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const existingPathInfo = (value: string) => fs.stat(value).pipe(Effect.option);

  const findRepositoryRoot = Effect.fn("VcsRepositoryWatcher.findRepositoryRoot")(function* (
    rawCwd: string,
  ) {
    let current = yield* fs.realPath(rawCwd).pipe(Effect.orElseSucceed(() => path.resolve(rawCwd)));

    while (true) {
      const gitEntry = path.join(current, ".git");
      if (Option.isSome(yield* existingPathInfo(gitEntry))) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  });

  const readGitDir = Effect.fn("VcsRepositoryWatcher.readGitDir")(function* (rootPath: string) {
    const gitEntry = path.join(rootPath, ".git");
    const info = yield* existingPathInfo(gitEntry);
    if (Option.isNone(info)) return null;
    if (info.value.type === "Directory") return gitEntry;
    if (info.value.type !== "File") return null;

    const contents = yield* fs.readFileString(gitEntry).pipe(Effect.option);
    if (Option.isNone(contents)) return null;
    const match = /^gitdir:\s*(.+)\s*$/im.exec(contents.value);
    const rawGitDir = match?.[1]?.trim();
    if (!rawGitDir) return null;
    return path.isAbsolute(rawGitDir) ? rawGitDir : path.resolve(rootPath, rawGitDir);
  });

  const resolveWatchPaths = Effect.fn("VcsRepositoryWatcher.resolveWatchPaths")(function* (
    cwd: string,
  ): Effect.fn.Return<RepositoryWatchPaths | null> {
    const rootPath = yield* findRepositoryRoot(cwd);
    if (rootPath === null) return null;
    const gitDir = yield* readGitDir(rootPath);
    if (gitDir === null) return null;

    const commonDirFile = path.join(gitDir, "commondir");
    const commonDirContents = yield* fs.readFileString(commonDirFile).pipe(Effect.option);
    const commonDir = Option.isSome(commonDirContents)
      ? path.resolve(gitDir, commonDirContents.value.trim())
      : gitDir;

    return {
      rootPath,
      metadataPaths: [...new Set([gitDir, commonDir])],
    };
  });

  const watchSafely = (
    watchedPath: string,
    predicate: (eventPath: string) => boolean,
  ): Stream.Stream<VcsRepositoryChange, never> =>
    fs.watch(watchedPath).pipe(
      Stream.filter((event) => predicate(event.path)),
      Stream.map(() => ({ source: "native" as const })),
      Stream.catchCause(() =>
        Stream.concat(
          Stream.fromEffect(
            Effect.logWarning("VCS repository watcher unavailable; using fallback polling").pipe(
              Effect.annotateLogs({ watchedPath }),
            ),
          ).pipe(Stream.drain),
          Stream.fromSchedule(Schedule.spaced(WATCH_FAILURE_POLL_INTERVAL)).pipe(
            Stream.map(() => ({ source: "poll" as const })),
          ),
        ),
      ),
    );

  const changes: VcsRepositoryWatcher["changes"] = (cwd) =>
    Stream.fromEffect(resolveWatchPaths(cwd)).pipe(
      Stream.flatMap((watchPaths) => {
        if (watchPaths === null) return Stream.make({ source: "poll" as const });
        const streams = [
          watchSafely(watchPaths.rootPath, isRelevantWorktreeWatchPath),
          ...watchPaths.metadataPaths.map((metadataPath) =>
            watchSafely(metadataPath, isRelevantGitMetadataWatchPath),
          ),
        ];
        return Stream.concat(
          Stream.make({ source: "poll" as const }),
          Stream.mergeAll(streams, { concurrency: "unbounded" }),
        );
      }),
      Stream.repeat(Schedule.spaced(WATCH_FAILURE_POLL_INTERVAL)),
    );

  return { changes } satisfies VcsRepositoryWatcher;
});
