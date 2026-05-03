import { Effect, Layer, Option, Result, Schema } from "effect";
import {
  SourceControlProviderError,
  type ChangeRequest,
  type ChangeRequestState,
} from "@t3tools/contracts";

import { GitHubCli, type GitHubCliError, type GitHubPullRequestSummary } from "./GitHubCli.ts";
import { decodeGitHubPullRequestListJson } from "./gitHubPullRequests.ts";
import { SourceControlProvider, type SourceControlProviderShape } from "./SourceControlProvider.ts";

function providerError(operation: string, cause: GitHubCliError): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "github",
    operation,
    detail: cause.detail,
    cause,
  });
}

function toChangeRequest(summary: GitHubPullRequestSummary): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function selectorRepositoryNameWithOwner(
  selector: { readonly owner?: string; readonly repository?: string } | undefined,
): string | undefined {
  const owner = selector?.owner?.trim() ?? "";
  const repository = selector?.repository?.trim() ?? "";
  return owner.length > 0 && repository.length > 0 ? `${owner}/${repository}` : undefined;
}

export const make = Effect.fn("makeGitHubSourceControlProvider")(function* () {
  const github = yield* GitHubCli;

  const listChangeRequests: SourceControlProviderShape["listChangeRequests"] = (input) => {
    const repository = selectorRepositoryNameWithOwner(input.source);
    if (input.state === "open") {
      return github
        .listOpenPullRequests({
          cwd: input.cwd,
          headSelector: input.headSelector,
          ...(repository !== undefined ? { repository } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) => providerError("listChangeRequests", error)),
        );
    }

    const stateArg: ChangeRequestState | "all" = input.state;
    return github
      .execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          ...(repository !== undefined ? ["--repo", repository] : []),
          "--head",
          input.headSelector,
          "--state",
          stateArg,
          "--limit",
          String(input.limit ?? 20),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      })
      .pipe(
        Effect.flatMap((result) => {
          const raw = result.stdout.trim();
          if (raw.length === 0) {
            return Effect.succeed([]);
          }
          return Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed(
                    decoded.success.map((item) => ({
                      ...toChangeRequest(item),
                      updatedAt: item.updatedAt,
                    })),
                  )
                : Effect.fail(
                    new SourceControlProviderError({
                      provider: "github",
                      operation: "listChangeRequests",
                      detail: "GitHub CLI returned invalid change request JSON.",
                      cause: decoded.failure,
                    }),
                  ),
            ),
          );
        }),
        Effect.mapError((error) =>
          Schema.is(SourceControlProviderError)(error)
            ? error
            : providerError("listChangeRequests", error),
        ),
      );
  };

  return SourceControlProvider.of({
    kind: "github",
    listChangeRequests,
    getChangeRequest: (input) =>
      github.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", error)),
      ),
    createChangeRequest: (input) =>
      github
        .createPullRequest({
          cwd: input.cwd,
          ...(() => {
            const repository = selectorRepositoryNameWithOwner(input.target ?? input.source);
            return repository !== undefined ? { repository } : {};
          })(),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", error))),
    getRepositoryCloneUrls: (input) =>
      github
        .getRepositoryCloneUrls(input)
        .pipe(Effect.mapError((error) => providerError("getRepositoryCloneUrls", error))),
    getDefaultBranch: (input) =>
      github
        .getDefaultBranch(input)
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", error))),
    checkoutChangeRequest: (input) =>
      github
        .checkoutPullRequest(input)
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", error))),
  });
});

export const layer = Layer.effect(SourceControlProvider, make());
