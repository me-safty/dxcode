import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Layer, Schema, SchemaIssue } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@marcode/contracts";

import { runProcess } from "../../processRunner.ts";
import { GitHostCliError } from "@marcode/contracts";
import {
  GitHubCli,
  type GitHubPullRequestSummary,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
} from "../Services/GitHubCli.ts";
import type {
  GitHostCliShape,
  HostPullRequestSummary,
  HostRepositoryCloneUrls,
} from "../Services/GitHostCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeGitHubCliError(operation: string, error: unknown): GitHostCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHostCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        provider: "github",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHostCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        provider: "github",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHostCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        provider: "github",
        cause: error,
      });
    }

    return new GitHostCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      provider: "github",
      cause: error,
    });
  }

  return new GitHostCliError({
    operation,
    detail: "GitHub CLI command failed.",
    provider: "github",
    cause: error,
  });
}

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      }),
    ),
  ),
});

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>,
): HostPullRequestSummary {
  const headRepositoryNameWithOwner = trimOrNull(raw.headRepository?.nameWithOwner);
  const headRepositoryOwnerLogin =
    trimOrNull(raw.headRepositoryOwner?.login) ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    ...(raw.updatedAt !== undefined ? { updatedAt: raw.updatedAt ?? null } : {}),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): HostRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: string,
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHostCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHostCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          provider: "github",
          cause: error,
        }),
    ),
  );
}

const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

function writeTempBodyFile(body: string): string {
  const filePath = join(tempDir, `marcode-pr-body-${process.pid}-${randomUUID()}.md`);
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

function removeTempBodyFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

const executeGh = (input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs?: number;
}) =>
  Effect.tryPromise({
    try: () =>
      runProcess("gh", input.args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    catch: (error) => normalizeGitHubCliError("execute", error),
  });

function listPullRequestsViaGh(
  run: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
  }) => Effect.Effect<{ stdout: string }, GitHostCliError>,
): GitHostCliShape["listPullRequests"] {
  return (input) => {
    const jsonFields =
      input.state === "all"
        ? "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt"
        : "number,title,url,baseRefName,headRefName";
    const args = [
      "pr",
      "list",
      "--head",
      input.headSelector,
      "--state",
      input.state === "all" ? "all" : "open",
      "--limit",
      String(input.limit ?? 1),
      "--json",
      jsonFields,
    ];
    if (input.repo) {
      args.push("--repo", input.repo);
    }
    return run({
      cwd: input.cwd,
      args,
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) => {
        if (raw.length === 0) return Effect.succeed([]);
        return decodeGitHubJson(
          raw,
          Schema.Array(Schema.Unknown),
          "listPullRequests",
          "GitHub CLI returned invalid PR list JSON.",
        ).pipe(
          Effect.map((items) => {
            const decode = Schema.decodeUnknownSync(RawGitHubPullRequestSchema);
            const valid: Array<Schema.Schema.Type<typeof RawGitHubPullRequestSchema>> = [];
            for (const item of items) {
              try {
                valid.push(decode(item));
              } catch {
                // skip entries that fail schema validation
              }
            }
            return valid;
          }),
        );
      }),
      Effect.map((pullRequests) => pullRequests.map(normalizePullRequestSummary)),
    );
  };
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) => executeGh(input);

  const listPullRequests = listPullRequestsViaGh(executeGh);

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      listPullRequests({
        cwd: input.cwd,
        headSelector: input.headSelector,
        state: "open",
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      }),
    getPullRequest: (input) =>
      executeGh({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestSchema,
            "getPullRequest",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map(normalizePullRequestSummary),
      ),
    getRepositoryCloneUrls: (input) =>
      executeGh({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) => {
      const args = [
        "pr",
        "create",
        "--base",
        input.baseBranch,
        "--head",
        input.headSelector,
        "--title",
        input.title,
        "--body-file",
        input.bodyFile,
      ];
      if (input.repo) {
        args.push("--repo", input.repo);
      }
      return executeGh({
        cwd: input.cwd,
        args,
      }).pipe(Effect.asVoid);
    },
    getDefaultBranch: (input) =>
      executeGh({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      executeGh({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);

export function toGitHostCliShape(github: GitHubCliShape): GitHostCliShape {
  return {
    provider: "github" as const,
    listPullRequests: listPullRequestsViaGh((input) => github.execute(input)),
    getPullRequest: (input) => github.getPullRequest(input),
    getRepositoryCloneUrls: (input) => github.getRepositoryCloneUrls(input),
    createPullRequest: (input) => {
      const bodyFile = writeTempBodyFile(input.body);
      const ghInput = {
        cwd: input.cwd,
        baseBranch: input.baseBranch,
        headSelector: input.headSelector,
        title: input.title,
        bodyFile,
        ...(input.repo ? { repo: input.repo } : {}),
      };
      return github
        .createPullRequest(ghInput)
        .pipe(Effect.ensuring(Effect.sync(() => removeTempBodyFile(bodyFile))));
    },
    getDefaultBranch: (input) => github.getDefaultBranch(input),
    checkoutPullRequest: (input) => github.checkoutPullRequest(input),
    pullRequestRefspecPrefix: () => "refs/pull",
  };
}

export type { GitHubPullRequestSummary, GitHubRepositoryCloneUrls };
