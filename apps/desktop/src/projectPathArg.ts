import * as FS from "node:fs";

const PROJECT_PATH_FLAG_PREFIX = "--t3-project-path=";

interface ParseOptions {
  readonly isDirectory?: (candidate: string) => boolean;
  readonly realpath?: (input: string) => string;
}

/**
 * Find a folder path in Electron argv.
 *
 * Covers three invocation shapes that all converge here:
 *   - `T3Code /path/to/project`                    (bare positional)
 *   - `open -a "T3 Code" --args /path/to/project`  (macOS, after --args)
 *   - `T3Code --t3-project-path=/path/to/project`  (atomic escape hatch)
 *
 * Returns the resolved real path (symlinks collapsed, `..` normalized) or null.
 *
 * Skips `-`-prefixed tokens so Chromium / Electron switches that land in argv —
 * especially the ones macOS injects into `second-instance.argv`, like
 * `--allow-file-access-from-files` — cannot be mistaken for a folder.
 */
export function parseFolderFromArgv(
  argv: readonly string[],
  options: ParseOptions = {},
): string | null {
  const isDirectory = options.isDirectory ?? defaultIsDirectory;
  const realpath = options.realpath ?? defaultRealpath;

  for (const token of argv) {
    if (!token.startsWith(PROJECT_PATH_FLAG_PREFIX)) continue;
    const value = token.slice(PROJECT_PATH_FLAG_PREFIX.length);
    if (value.length === 0) continue;
    const resolved = resolveDirectory(value, realpath, isDirectory);
    if (resolved) return resolved;
  }

  for (const token of argv) {
    if (token.length === 0 || token.startsWith("-")) continue;
    const resolved = resolveDirectory(token, realpath, isDirectory);
    if (resolved) return resolved;
  }

  return null;
}

function resolveDirectory(
  candidate: string,
  realpath: (input: string) => string,
  isDirectory: (candidate: string) => boolean,
): string | null {
  try {
    const resolved = realpath(candidate);
    return isDirectory(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function defaultIsDirectory(candidate: string): boolean {
  try {
    return FS.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function defaultRealpath(input: string): string {
  return FS.realpathSync.native(input);
}
