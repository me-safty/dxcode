import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ResolveNightlyReleaseOptions {
  readonly date: string;
  readonly runNumber: string;
  readonly sha: string;
  readonly rootDir?: string;
}

interface NightlyReleaseMetadata {
  readonly baseVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly name: string;
  readonly shortSha: string;
}

function validateDate(date: string): string {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Invalid nightly release date '${date}'. Expected YYYYMMDD.`);
  }
  return date;
}

function validateRunNumber(runNumber: string): string {
  if (!/^[1-9]\d*$/.test(runNumber)) {
    throw new Error(`Invalid nightly run number '${runNumber}'. Expected a positive integer.`);
  }
  return runNumber;
}

function validateSha(sha: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`Invalid git sha '${sha}'. Expected 7-40 hex characters.`);
  }
  return sha.toLowerCase();
}

function resolveBaseVersion(rootDir: string): string {
  const packageJsonPath = resolve(rootDir, "apps/desktop/package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing string version in ${packageJsonPath}.`);
  }

  const match = packageJson.version.match(/^(\d+\.\d+\.\d+)/);
  if (!match) {
    throw new Error(
      `Desktop package version '${packageJson.version}' does not start with X.Y.Z semver core.`,
    );
  }

  const [baseVersion] = match;
  return baseVersion;
}

export function resolveNightlyReleaseMetadata(
  options: ResolveNightlyReleaseOptions,
): NightlyReleaseMetadata {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const date = validateDate(options.date);
  const runNumber = validateRunNumber(options.runNumber);
  const sha = validateSha(options.sha);
  const shortSha = sha.slice(0, 12);
  const baseVersion = resolveBaseVersion(rootDir);
  const version = `${baseVersion}-nightly.${date}.${runNumber}`;

  return {
    baseVersion,
    version,
    tag: `nightly-v${version}`,
    name: `T3 Code Nightly ${version} (${shortSha})`,
    shortSha,
  };
}

function parseArgs(argv: ReadonlyArray<string>): {
  readonly date: string;
  readonly runNumber: string;
  readonly sha: string;
  readonly rootDir?: string;
  readonly writeGithubOutput: boolean;
} {
  let date: string | undefined;
  let runNumber: string | undefined;
  let sha: string | undefined;
  let rootDir: string | undefined;
  let writeGithubOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--github-output") {
      writeGithubOutput = true;
      continue;
    }

    if (argument === "--date") {
      date = argv[index + 1];
      if (!date) {
        throw new Error("Missing value for --date.");
      }
      index += 1;
      continue;
    }

    if (argument === "--run-number") {
      runNumber = argv[index + 1];
      if (!runNumber) {
        throw new Error("Missing value for --run-number.");
      }
      index += 1;
      continue;
    }

    if (argument === "--sha") {
      sha = argv[index + 1];
      if (!sha) {
        throw new Error("Missing value for --sha.");
      }
      index += 1;
      continue;
    }

    if (argument === "--root") {
      rootDir = argv[index + 1];
      if (!rootDir) {
        throw new Error("Missing value for --root.");
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!date || !runNumber || !sha) {
    throw new Error(
      "Usage: node scripts/resolve-nightly-release.ts --date <YYYYMMDD> --run-number <n> --sha <git-sha> [--root <path>] [--github-output]",
    );
  }

  return {
    date,
    runNumber,
    sha,
    ...(rootDir === undefined ? {} : { rootDir }),
    writeGithubOutput,
  };
}

function writeMetadata(metadata: NightlyReleaseMetadata, writeGithubOutput: boolean): void {
  const entries = {
    base_version: metadata.baseVersion,
    version: metadata.version,
    tag: metadata.tag,
    name: metadata.name,
    short_sha: metadata.shortSha,
  };

  if (writeGithubOutput) {
    const githubOutputPath = process.env.GITHUB_OUTPUT;
    if (!githubOutputPath) {
      throw new Error("GITHUB_OUTPUT is required when --github-output is set.");
    }

    for (const [key, value] of Object.entries(entries)) {
      appendFileSync(githubOutputPath, `${key}=${value}\n`);
    }
    return;
  }

  for (const [key, value] of Object.entries(entries)) {
    console.log(`${key}=${value}`);
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { date, runNumber, sha, rootDir, writeGithubOutput } = parseArgs(process.argv.slice(2));
  const metadata = resolveNightlyReleaseMetadata({
    date,
    runNumber,
    sha,
    ...(rootDir === undefined ? {} : { rootDir }),
  });
  writeMetadata(metadata, writeGithubOutput);
}
