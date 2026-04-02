import * as path from "node:path";

import {
  formatGitListBranchesRpcBenchmarkReport,
  runGitListBranchesRpcBenchmark,
} from "./lib/git-list-branches-rpc-benchmark";

interface CliOptions {
  readonly cwd?: string;
  readonly fixturePath?: string;
  readonly iterations?: number;
  readonly json?: boolean;
  readonly warmupIterations?: number;
}

function parseIntegerFlag(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${flag} to be an integer, received ${value}.`);
  }
  return parsed;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let fixturePath = path.resolve(import.meta.dirname, "../git-branches.json");
  let iterations: number | undefined;
  let warmupIterations: number | undefined;
  let cwd: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === "--json") {
      json = true;
      continue;
    }

    if (argument === "--fixture") {
      fixturePath = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (argument.startsWith("--fixture=")) {
      fixturePath = path.resolve(process.cwd(), argument.slice("--fixture=".length));
      continue;
    }

    if (argument === "--iterations") {
      iterations = parseIntegerFlag(argv[index + 1] ?? "", "--iterations");
      index += 1;
      continue;
    }

    if (argument.startsWith("--iterations=")) {
      iterations = parseIntegerFlag(argument.slice("--iterations=".length), "--iterations");
      continue;
    }

    if (argument === "--warmup") {
      warmupIterations = parseIntegerFlag(argv[index + 1] ?? "", "--warmup");
      index += 1;
      continue;
    }

    if (argument.startsWith("--warmup=")) {
      warmupIterations = parseIntegerFlag(argument.slice("--warmup=".length), "--warmup");
      continue;
    }

    if (argument === "--cwd") {
      cwd = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (argument.startsWith("--cwd=")) {
      cwd = argument.slice("--cwd=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    fixturePath,
    json,
    ...(cwd === undefined ? {} : { cwd }),
    ...(iterations === undefined ? {} : { iterations }),
    ...(warmupIterations === undefined ? {} : { warmupIterations }),
  };
}

const options = parseArgs(process.argv.slice(2));
const report = await runGitListBranchesRpcBenchmark(options);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatGitListBranchesRpcBenchmarkReport(report));
}
