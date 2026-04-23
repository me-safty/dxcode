/**
 * GitLabCli – GitHostCliShape implementation wrapping the `glab` CLI.
 *
 * @module GitLabCli
 */
import { Effect, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@marcode/contracts";

import { runProcess } from "../../processRunner.ts";
import { GitHostCliError } from "@marcode/contracts";
import type {
  GitHostCliShape,
  HostPullRequestSummary,
  HostRepositoryCloneUrls,
} from "../Services/GitHostCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeGitLabCliError(operation: string, error: unknown): GitHostCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: glab")) {
      return new GitHostCliError({
        operation,
        detail:
          "GitLab CLI (`glab`) is required but not available on PATH. Install: https://gitlab.com/gitlab-org/cli#installation",
        provider: "gitlab",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication") ||
      lower.includes("not logged in") ||
      lower.includes("glab auth login") ||
      lower.includes("401") ||
      lower.includes("token")
    ) {
      return new GitHostCliError({
        operation,
        detail: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
        provider: "gitlab",
        cause: error,
      });
    }

    if (
      lower.includes("merge request not found") ||
      lower.includes("404 not found") ||
      lower.includes("could not find merge request")
    ) {
      return new GitHostCliError({
        operation,
        detail: "Merge request not found. Check the MR number or URL and try again.",
        provider: "gitlab",
        cause: error,
      });
    }

    return new GitHostCliError({
      operation,
      detail: `GitLab CLI command failed: ${error.message}`,
      provider: "gitlab",
      cause: error,
    });
  }

  return new GitHostCliError({
    operation,
    detail: "GitLab CLI command failed.",
    provider: "gitlab",
    cause: error,
  });
}

const executeGlab = (input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs?: number;
}) =>
  Effect.tryPromise({
    try: () =>
      runProcess("glab", input.args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    catch: (error) => normalizeGitLabCliError("execute", error),
  });

function normalizeGitLabMrState(state: string | null | undefined): "open" | "closed" | "merged" {
  const normalized = (state ?? "").toLowerCase().trim();
  if (normalized === "merged") return "merged";
  if (normalized === "closed") return "closed";
  return "open";
}

const RawGitLabMrSchema = Schema.Struct({
  iid: PositiveInt,
  title: TrimmedNonEmptyString,
  web_url: TrimmedNonEmptyString,
  source_branch: TrimmedNonEmptyString,
  target_branch: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitLabRepoSchema = Schema.Struct({
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
});

function decodeGitLabJson<S extends Schema.Top>(
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
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          provider: "gitlab",
          cause: error,
        }),
    ),
  );
}

function normalizeMrSummary(
  raw: Schema.Schema.Type<typeof RawGitLabMrSchema>,
): HostPullRequestSummary {
  return {
    number: raw.iid,
    title: raw.title,
    url: raw.web_url,
    baseRefName: raw.target_branch,
    headRefName: raw.source_branch,
    state: normalizeGitLabMrState(raw.state),
    updatedAt: raw.updated_at ?? null,
  };
}

export function makeGitLabCliShape(): GitHostCliShape {
  const listPullRequests: GitHostCliShape["listPullRequests"] = (input) => {
    const args = [
      "mr",
      "list",
      "--source-branch",
      input.headSelector,
      ...(input.state === "all" ? ["--all"] : []),
      "--per-page",
      String(input.limit ?? 20),
      "-F",
      "json",
    ];
    if (input.repo) {
      args.push("--repo", input.repo);
    }
    return executeGlab({
      cwd: input.cwd,
      args,
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) => {
        if (raw.length === 0 || raw === "[]") {
          return Effect.succeed([]);
        }
        return decodeGitLabJson(
          raw,
          Schema.Array(RawGitLabMrSchema),
          "listPullRequests",
          "GitLab CLI returned invalid MR list JSON.",
        );
      }),
      Effect.map((mergeRequests) => mergeRequests.map(normalizeMrSummary)),
    );
  };

  const getPullRequest: GitHostCliShape["getPullRequest"] = (input) =>
    executeGlab({
      cwd: input.cwd,
      args: ["mr", "view", input.reference, "-F", "json"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        decodeGitLabJson(
          raw,
          RawGitLabMrSchema,
          "getPullRequest",
          "GitLab CLI returned invalid merge request JSON.",
        ),
      ),
      Effect.map(normalizeMrSummary),
    );

  const getRepositoryCloneUrls: GitHostCliShape["getRepositoryCloneUrls"] = (_input) =>
    Effect.fail(
      new GitHostCliError({
        operation: "getRepositoryCloneUrls",
        detail: "Fork-based MR workflows are not yet supported for GitLab.",
        provider: "gitlab",
      }),
    ) as Effect.Effect<HostRepositoryCloneUrls, GitHostCliError>;

  const createPullRequest: GitHostCliShape["createPullRequest"] = (input) => {
    const args = [
      "mr",
      "create",
      "--target-branch",
      input.baseBranch,
      "--source-branch",
      input.headSelector,
      "--title",
      input.title,
      "--description",
      input.body,
      "--no-editor",
    ];
    if (input.repo) {
      args.push("--repo", input.repo);
    }
    return executeGlab({
      cwd: input.cwd,
      args,
    }).pipe(Effect.asVoid);
  };

  const getDefaultBranch: GitHostCliShape["getDefaultBranch"] = (input) =>
    executeGlab({
      cwd: input.cwd,
      args: ["repo", "view", "-F", "json"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        decodeGitLabJson(
          raw,
          RawGitLabRepoSchema,
          "getDefaultBranch",
          "GitLab CLI returned invalid repository JSON.",
        ),
      ),
      Effect.map((repo) => {
        const branch = repo.default_branch?.trim() ?? "";
        return branch.length > 0 ? branch : null;
      }),
    );

  const checkoutPullRequest: GitHostCliShape["checkoutPullRequest"] = (input) =>
    executeGlab({
      cwd: input.cwd,
      args: ["mr", "checkout", input.reference],
    }).pipe(Effect.asVoid);

  return {
    provider: "gitlab" as const,
    listPullRequests,
    getPullRequest,
    getRepositoryCloneUrls,
    createPullRequest,
    getDefaultBranch,
    checkoutPullRequest,
    pullRequestRefspecPrefix: () => "refs/merge-requests",
  };
}
