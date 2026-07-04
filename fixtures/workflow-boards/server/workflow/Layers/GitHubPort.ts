import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GitHubPullRequestCheck } from "@t3tools/plugin-sdk";
import { WorkflowEventStoreError } from "../Services/Errors.ts";
import {
  GitHubPort,
  type GitHubPortShape,
  type GitHubPrDetail,
  type GitHubReviewItem,
} from "../Services/GitHubPort.ts";
import {
  WorkflowFilesystemCapability,
  WorkflowSourceControlCapability,
  WorkflowVcsCapability,
} from "../Services/WorkflowCapabilities.ts";

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

const eventStoreError = (message: string, cause?: unknown): WorkflowEventStoreError =>
  new WorkflowEventStoreError(cause === undefined ? { message } : { message, cause });

const NOT_MERGEABLE_PATTERNS = [
  "not mergeable",
  "not in a mergeable state",
  "branch protection",
  "protected branch",
  "has conflicts",
  "review required",
  "review is required",
  "changes requested",
  "approving review",
  "changes to the base branch",
  "status checks are expected",
  "status checks have not succeeded",
  "required status checks have not passed",
];

const looksNotMergeable = (text: string): boolean => {
  const lower = text.toLowerCase();
  return NOT_MERGEABLE_PATTERNS.some((pattern) => lower.includes(pattern));
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const matchableErrorText = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const fields = error as {
      readonly stderr?: unknown;
      readonly cause?: unknown;
      readonly detail?: unknown;
      readonly message?: unknown;
    };
    const stderr = stringField(fields.stderr);
    if (stderr !== null) return stderr;
    if (fields.cause !== undefined && fields.cause !== null) {
      const causeText = matchableErrorText(fields.cause);
      if (causeText.trim().length > 0) return causeText;
    }
    const detail = stringField(fields.detail);
    if (detail !== null) return detail;
    const message = stringField(fields.message);
    if (message !== null) return message;
  }
  return errorText(error);
};

const normalizeReviewDecision = (value: string | null): GitHubPrDetail["reviewDecision"] => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "CHANGES_REQUESTED") return "changes_requested";
  if (normalized === "APPROVED") return "approved";
  return "none";
};

const normalizeState = (input: {
  state: string;
  mergedAt: string | null;
}): GitHubPrDetail["state"] => {
  const normalized = input.state.trim().toUpperCase();
  if (normalized === "MERGED" || (input.mergedAt !== null && input.mergedAt.trim().length > 0)) {
    return "merged";
  }
  if (normalized === "CLOSED") return "closed";
  return "open";
};

const ciStateFromChecks = (
  checks: ReadonlyArray<GitHubPullRequestCheck>,
): GitHubPrDetail["ciState"] => {
  if (checks.length === 0) return "success";
  let pending = false;
  for (const check of checks) {
    const bucket = check.bucket.trim().toLowerCase();
    if (bucket === "fail" || bucket === "cancel") return "failure";
    if (bucket === "pending") pending = true;
  }
  return pending ? "pending" : "success";
};

const make = Effect.gen(function* () {
  const filesystem = yield* WorkflowFilesystemCapability;
  const sourceControl = yield* WorkflowSourceControlCapability;
  const vcs = yield* WorkflowVcsCapability;

  const mapSourceError = (message: string) => (cause: unknown) =>
    eventStoreError(`${message}: ${errorText(cause)}`, cause);

  const resolveRemote: GitHubPortShape["resolveRemote"] = (cwd) =>
    sourceControl.detectProvider({ cwd }).pipe(
      Effect.mapError(mapSourceError("failed to resolve source control remote")),
      Effect.flatMap((context) => {
        if (context.provider === null || context.remoteName === null) {
          return Effect.fail(eventStoreError(`no source control remote detected for ${cwd}`));
        }
        const parsed =
          context.remoteUrl === null
            ? null
            : parseGitHubRepositoryNameWithOwnerFromRemoteUrl(context.remoteUrl);
        if (parsed !== null) {
          return Effect.succeed({ remoteName: context.remoteName, repo: parsed });
        }
        return sourceControl.getRepositoryCloneUrls({ cwd, repository: context.remoteName }).pipe(
          Effect.map((urls) => ({ remoteName: context.remoteName!, repo: urls.nameWithOwner })),
          Effect.mapError(mapSourceError("failed to resolve repository name")),
        );
      }),
    );

  const preflight: GitHubPortShape["preflight"] = (cwd) =>
    sourceControl.detectProvider({ cwd }).pipe(
      Effect.map((result) =>
        result.provider === null
          ? ({ ok: false, reason: `no source control remote detected for ${cwd}` } as const)
          : ({ ok: true } as const),
      ),
      Effect.catch((cause) =>
        Effect.succeed({
          ok: false,
          reason: errorText(cause),
        } as const),
      ),
    );

  const defaultBranch: GitHubPortShape["defaultBranch"] = (cwd) =>
    sourceControl.getDefaultBranch({ cwd }).pipe(
      Effect.mapError(mapSourceError("failed to resolve default branch")),
      Effect.flatMap((branch) =>
        branch === null
          ? Effect.fail(eventStoreError("github returned no default branch"))
          : Effect.succeed(branch),
      ),
    );

  const findPr = (input: { cwd: string; branch: string }) =>
    sourceControl
      .listOpenPullRequests({ cwd: input.cwd, headSelector: input.branch })
      .pipe(Effect.mapError(mapSourceError("failed to list open pull requests")));

  const withPrBodyFile = <A>(
    cwd: string,
    body: string,
    useFile: (bodyFile: string) => Effect.Effect<A, WorkflowEventStoreError>,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const relativePath = `.t3/pr-body-${now}.md`;
      yield* filesystem.makeDirectory({ root: cwd, relativePath: ".t3" }).pipe(Effect.ignore);
      yield* filesystem
        .writeFileString({ root: cwd, relativePath, contents: body })
        .pipe(Effect.mapError(mapSourceError("failed to write PR body file")));
      return yield* useFile(`${cwd}/${relativePath}`).pipe(
        Effect.ensuring(filesystem.remove({ root: cwd, relativePath }).pipe(Effect.ignore)),
      );
    });

  const openPr: GitHubPortShape["openPr"] = (input) =>
    Effect.gen(function* () {
      const remote = yield* resolveRemote(input.cwd);
      yield* vcs
        .push({
          worktreePath: input.cwd,
          remoteName: remote.remoteName,
          fallbackBranch: input.branch,
        })
        .pipe(
          Effect.mapError((cause) => {
            const text = matchableErrorText(cause);
            const combined = text.toLowerCase();
            if (
              combined.includes("non-fast-forward") ||
              combined.includes("fetch first") ||
              (combined.includes("[rejected]") && !combined.includes("[remote rejected]"))
            ) {
              return eventStoreError(
                `branch diverged: ${firstLine(text) || "remote push rejected"}`,
                cause,
              );
            }
            return eventStoreError(
              `failed to push branch: ${firstLine(text) || "push failed"}`,
              cause,
            );
          }),
        );

      const existing = yield* findPr({ cwd: input.cwd, branch: input.branch });
      const adoptedPr = existing[0];
      if (adoptedPr !== undefined) {
        return { number: adoptedPr.number, url: adoptedPr.url, adopted: true };
      }

      yield* withPrBodyFile(input.cwd, input.body, (bodyFile) =>
        sourceControl
          .createPullRequest({
            cwd: input.cwd,
            baseBranch: input.base,
            headSelector: input.branch,
            title: input.title,
            bodyFile,
            draft: input.draft,
          })
          .pipe(Effect.mapError(mapSourceError("failed to create pull request"))),
      );

      const created = yield* findPr({ cwd: input.cwd, branch: input.branch });
      const createdPr = created[0];
      if (createdPr === undefined) {
        return yield* eventStoreError("pull request created but could not be located by branch");
      }
      return { number: createdPr.number, url: createdPr.url, adopted: false };
    });

  const findPrForBranch: GitHubPortShape["findPrForBranch"] = (input) =>
    findPr({ cwd: input.cwd, branch: input.branch }).pipe(
      Effect.map((prs) => {
        const pr = prs[0];
        return pr === undefined ? null : { number: pr.number, url: pr.url };
      }),
    );

  const prDetail: GitHubPortShape["prDetail"] = (input) =>
    Effect.gen(function* () {
      const detail = yield* sourceControl
        .getPullRequestDetail({ cwd: input.cwd, number: input.prNumber })
        .pipe(Effect.mapError(mapSourceError("failed to read pull request detail")));
      const checks = yield* sourceControl
        .listPullRequestChecks({ cwd: input.cwd, number: input.prNumber })
        .pipe(Effect.mapError(mapSourceError("failed to read pull request checks")));

      return {
        number: input.prNumber,
        url: detail.url,
        state: normalizeState({ state: detail.state, mergedAt: detail.mergedAt }),
        headSha: detail.headRefOid.trim().length > 0 ? detail.headRefOid : null,
        reviewDecision: normalizeReviewDecision(detail.reviewDecision),
        ciState: ciStateFromChecks(checks),
      } satisfies GitHubPrDetail;
    });

  const mergePr: GitHubPortShape["mergePr"] = (input) =>
    sourceControl
      .mergePullRequest({ cwd: input.cwd, number: input.prNumber, strategy: input.strategy })
      .pipe(
        Effect.matchEffect({
          onFailure: (error) => {
            const text = matchableErrorText(error);
            return looksNotMergeable(text)
              ? Effect.succeed({ ok: false, reason: firstLine(text) } as
                  | { ok: true }
                  | { ok: false; reason: string })
              : Effect.fail(eventStoreError("failed to merge pull request", error));
          },
          onSuccess: () => Effect.succeed({ ok: true } as const),
        }),
      );

  const failingCheckLogs: GitHubPortShape["failingCheckLogs"] = (input) =>
    Effect.gen(function* () {
      const checks = yield* sourceControl
        .listPullRequestChecks({ cwd: input.cwd, number: input.prNumber })
        .pipe(Effect.mapError(mapSourceError("failed to read pull request checks")));
      const failing = checks.filter((check) => {
        const bucket = check.bucket.trim().toLowerCase();
        return bucket === "fail" || bucket === "cancel";
      });
      if (failing.length === 0) {
        return null;
      }
      return failing
        .map((check) => check.name)
        .filter((name) => name.length > 0)
        .join(", ");
    });

  const listReviewFeedback: GitHubPortShape["listReviewFeedback"] = (input) =>
    Effect.gen(function* () {
      const reviews = yield* sourceControl
        .listPullRequestReviews({ cwd: input.cwd, number: input.prNumber })
        .pipe(Effect.mapError(mapSourceError("failed to read pull request reviews")));
      const comments = yield* sourceControl
        .listPullRequestReviewComments({
          cwd: input.cwd,
          repo: input.repo,
          number: input.prNumber,
        })
        .pipe(Effect.mapError(mapSourceError("failed to read pull request review comments")));

      const items: Array<GitHubReviewItem & { sortKey: string }> = [];
      for (const review of reviews) {
        if (review.body.trim().length === 0) continue;
        items.push({
          id: review.id,
          author: review.author,
          body: review.body,
          submittedAt: review.submittedAt,
          sortKey: review.submittedAt,
        });
      }
      for (const comment of comments) {
        if (comment.body.trim().length === 0) continue;
        items.push({
          id: `comment:${comment.id}`,
          author: comment.user,
          body: comment.body,
          submittedAt: comment.createdAt,
          sortKey: comment.createdAt,
        });
      }

      items.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
      return items.map(({ sortKey: _sortKey, ...item }) => item);
    });

  return {
    preflight,
    resolveRemote,
    defaultBranch,
    openPr,
    findPrForBranch,
    prDetail,
    mergePr,
    failingCheckLogs,
    listReviewFeedback,
  } satisfies GitHubPortShape;
});

export const GitHubPortLive = Layer.effect(GitHubPort, make);
