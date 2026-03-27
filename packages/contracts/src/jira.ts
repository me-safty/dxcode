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

export const SecDeskRequestType = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
export type SecDeskRequestType = typeof SecDeskRequestType.Type;

export const JiraCreateSecDeskRequestInput = Schema.Struct({
  requestTypeId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
export type JiraCreateSecDeskRequestInput = typeof JiraCreateSecDeskRequestInput.Type;

export const JiraCreateSecDeskRequestResult = Schema.Struct({
  issueKey: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
});
export type JiraCreateSecDeskRequestResult = typeof JiraCreateSecDeskRequestResult.Type;

export const JiraListSecDeskRequestTypesInput = Schema.Struct({});
export type JiraListSecDeskRequestTypesInput = typeof JiraListSecDeskRequestTypesInput.Type;

export const JiraTransitionInput = Schema.Struct({
  ticketKey: TrimmedNonEmptyString,
  /** Transition name (e.g. "In Progress", "Done") — the server resolves it to the numeric ID. */
  transitionName: TrimmedNonEmptyString,
});
export type JiraTransitionInput = typeof JiraTransitionInput.Type;

export const JIRA_WS_METHODS = {
  jiraList: "jira.list",
  jiraGet: "jira.get",
  jiraSearch: "jira.search",
  jiraRefresh: "jira.refresh",
  jiraPostComment: "jira.postComment",
  jiraTransition: "jira.transition",
  jiraListSecDeskRequestTypes: "jira.listSecDeskRequestTypes",
  jiraCreateSecDeskRequest: "jira.createSecDeskRequest",
} as const;

export const JIRA_WS_CHANNELS = {
  jiraTicketsUpdated: "jira.ticketsUpdated",
} as const;
