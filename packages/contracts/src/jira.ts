import { Schema } from "effect";
import { ProjectId, TrimmedNonEmptyString, IsoDateTime } from "./baseSchemas";

export const JiraTicket = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  priority: TrimmedNonEmptyString,
  issueType: TrimmedNonEmptyString,
  assignee: Schema.NullOr(TrimmedNonEmptyString),
  reporter: Schema.NullOr(TrimmedNonEmptyString),
  description: Schema.NullOr(Schema.String),
  components: Schema.Array(TrimmedNonEmptyString),
  labels: Schema.Array(TrimmedNonEmptyString),
  parentKey: Schema.NullOr(TrimmedNonEmptyString),
  url: TrimmedNonEmptyString,
  created: IsoDateTime,
  updated: IsoDateTime,
});
export type JiraTicket = typeof JiraTicket.Type;

export const JiraListInput = Schema.Struct({
  assignee: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(TrimmedNonEmptyString),
  maxResults: Schema.optional(Schema.Number),
});
export type JiraListInput = typeof JiraListInput.Type;

export const JiraGetInput = Schema.Struct({
  ticketKey: TrimmedNonEmptyString,
});
export type JiraGetInput = typeof JiraGetInput.Type;

export const JiraSearchInput = Schema.Struct({
  jql: TrimmedNonEmptyString,
  maxResults: Schema.optional(Schema.Number),
});
export type JiraSearchInput = typeof JiraSearchInput.Type;

export const JiraRefreshInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type JiraRefreshInput = typeof JiraRefreshInput.Type;

export const JiraPostCommentInput = Schema.Struct({
  ticketKey: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
});
export type JiraPostCommentInput = typeof JiraPostCommentInput.Type;

export const JIRA_WS_METHODS = {
  jiraList: "jira.list",
  jiraGet: "jira.get",
  jiraSearch: "jira.search",
  jiraRefresh: "jira.refresh",
  jiraPostComment: "jira.postComment",
} as const;

export const JIRA_WS_CHANNELS = {
  jiraTicketsUpdated: "jira.ticketsUpdated",
} as const;
