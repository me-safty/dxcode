/**
 * BitbucketApi - Effect service contract for Bitbucket Cloud REST API interactions.
 *
 * Provides PR operations for Bitbucket repositories, parallel to GitHubCli.
 *
 * @module BitbucketApi
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { BitbucketApiError } from "../Errors.ts";

export interface BitbucketPullRequestSummary {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly sourceRefName: string;
  readonly destinationRefName: string;
  readonly state: "open" | "closed" | "merged";
}

/**
 * BitbucketApiShape - Service API for Bitbucket Cloud REST API.
 */
export interface BitbucketApiShape {
  /**
   * List open pull requests for a source branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly workspace: string;
    readonly repoSlug: string;
    readonly sourceBranch: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<BitbucketPullRequestSummary>, BitbucketApiError>;

  /**
   * Get a pull request by ID.
   */
  readonly getPullRequest: (input: {
    readonly workspace: string;
    readonly repoSlug: string;
    readonly prId: number;
  }) => Effect.Effect<BitbucketPullRequestSummary, BitbucketApiError>;

  /**
   * Create a pull request.
   */
  readonly createPullRequest: (input: {
    readonly workspace: string;
    readonly repoSlug: string;
    readonly sourceBranch: string;
    readonly destinationBranch: string;
    readonly title: string;
    readonly description: string;
  }) => Effect.Effect<BitbucketPullRequestSummary, BitbucketApiError>;

  /**
   * Get the default branch (main branch) for a repository.
   */
  readonly getDefaultBranch: (input: {
    readonly workspace: string;
    readonly repoSlug: string;
  }) => Effect.Effect<string | null, BitbucketApiError>;

  /**
   * List all pull requests (any state) for a source branch.
   */
  readonly listAllPullRequests: (input: {
    readonly workspace: string;
    readonly repoSlug: string;
    readonly sourceBranch: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<BitbucketPullRequestSummary>, BitbucketApiError>;
}

/**
 * BitbucketApi - Service tag for Bitbucket Cloud REST API.
 */
export class BitbucketApi extends ServiceMap.Service<BitbucketApi, BitbucketApiShape>()(
  "t3/git/Services/BitbucketApi",
) {}
