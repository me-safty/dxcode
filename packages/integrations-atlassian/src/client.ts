import * as Data from "effect/Data";

export class AtlassianApiError extends Data.TaggedError("AtlassianApiError")<{
  readonly status: number;
  readonly message: string;
  readonly path: string;
}> {}

export class AtlassianNetworkError extends Data.TaggedError("AtlassianNetworkError")<{
  readonly cause: unknown;
  readonly path: string;
}> {}

export class AtlassianAuthError extends Data.TaggedError("AtlassianAuthError")<{
  readonly message: string;
  readonly path: string;
}> {}

export type AtlassianCredentialSet = {
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
};

export type JiraMyself = {
  readonly accountId: string;
  readonly displayName: string;
  readonly emailAddress?: string;
};

export type JiraProject = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly projectTypeKey?: string;
  readonly avatarUrls?: Record<string, string>;
  readonly self?: string;
};

export type JiraProjectSearchResponse = {
  readonly values: ReadonlyArray<JiraProject>;
  readonly total: number;
  readonly isLast?: boolean;
};

export type JiraIssueSearchResponse = {
  readonly issues: ReadonlyArray<unknown>;
  readonly total: number;
  readonly startAt?: number;
  readonly maxResults?: number;
};

export type JiraIssue = {
  readonly id: string;
  readonly key: string;
  readonly self: string;
  readonly fields: Record<string, unknown>;
};

export type JiraComment = {
  readonly id: string;
  readonly body?: unknown;
  readonly author?: {
    readonly displayName?: string;
  };
  readonly created?: string;
  readonly updated?: string;
};

export type JiraCommentsResponse = {
  readonly comments: ReadonlyArray<JiraComment>;
  readonly total: number;
};
