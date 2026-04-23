import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const JiraCloudId = TrimmedNonEmptyString.pipe(Schema.brand("JiraCloudId"));
export type JiraCloudId = typeof JiraCloudId.Type;

export const JiraBoardId = NonNegativeInt.pipe(Schema.brand("JiraBoardId"));
export type JiraBoardId = typeof JiraBoardId.Type;

export const JiraSprintId = NonNegativeInt.pipe(Schema.brand("JiraSprintId"));
export type JiraSprintId = typeof JiraSprintId.Type;

export const JiraIssueKey = TrimmedNonEmptyString.pipe(Schema.brand("JiraIssueKey"));
export type JiraIssueKey = typeof JiraIssueKey.Type;

export const JiraBoardReference = Schema.Struct({
  cloudId: JiraCloudId,
  boardId: JiraBoardId,
});
export type JiraBoardReference = typeof JiraBoardReference.Type;

export const JiraUser = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  avatarUrl: Schema.optional(TrimmedNonEmptyString),
});
export type JiraUser = typeof JiraUser.Type;

export const JiraSite = Schema.Struct({
  cloudId: JiraCloudId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  avatarUrl: Schema.optional(TrimmedNonEmptyString),
});
export type JiraSite = typeof JiraSite.Type;

export const JiraConnectionStatus = Schema.Struct({
  connected: Schema.Boolean,
  sites: Schema.Array(JiraSite),
  user: Schema.optional(JiraUser),
});
export type JiraConnectionStatus = typeof JiraConnectionStatus.Type;

export const JiraBoardType = Schema.Literals(["scrum", "kanban", "simple"]);
export type JiraBoardType = typeof JiraBoardType.Type;

export const JiraBoard = Schema.Struct({
  id: JiraBoardId,
  name: TrimmedNonEmptyString,
  type: JiraBoardType,
});
export type JiraBoard = typeof JiraBoard.Type;

export const JiraSprintState = Schema.Literals(["active", "closed", "future"]);
export type JiraSprintState = typeof JiraSprintState.Type;

export const JiraSprint = Schema.Struct({
  id: JiraSprintId,
  name: TrimmedNonEmptyString,
  state: JiraSprintState,
  startDate: Schema.optional(IsoDateTime),
  endDate: Schema.optional(IsoDateTime),
});
export type JiraSprint = typeof JiraSprint.Type;

export const JiraAttachmentRef = Schema.Struct({
  id: TrimmedNonEmptyString,
  filename: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  size: NonNegativeInt,
});
export type JiraAttachmentRef = typeof JiraAttachmentRef.Type;

export const JiraIssue = Schema.Struct({
  key: JiraIssueKey,
  summary: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  issueType: TrimmedNonEmptyString,
  priority: Schema.optional(TrimmedNonEmptyString),
  assignee: Schema.optional(JiraUser),
  description: Schema.optional(Schema.String),
  labels: Schema.Array(Schema.String),
  attachments: Schema.Array(JiraAttachmentRef),
  url: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type JiraIssue = typeof JiraIssue.Type;

export const JIRA_WS_METHODS = {
  getConnectionStatus: "jira.getConnectionStatus",
  disconnect: "jira.disconnect",
  listSites: "jira.listSites",
  listBoards: "jira.listBoards",
  listSprints: "jira.listSprints",
  listIssues: "jira.listIssues",
  getIssue: "jira.getIssue",
  getAttachment: "jira.getAttachment",
} as const;

export const JIRA_WS_CHANNELS = {
  connectionStatusChanged: "jira.connectionStatusChanged",
} as const;

export const JiraListBoardsInput = Schema.Struct({
  cloudId: JiraCloudId,
});
export type JiraListBoardsInput = typeof JiraListBoardsInput.Type;

export const JiraListBoardsResult = Schema.Struct({
  boards: Schema.Array(JiraBoard),
});
export type JiraListBoardsResult = typeof JiraListBoardsResult.Type;

export const JiraListSprintsInput = Schema.Struct({
  cloudId: JiraCloudId,
  boardId: JiraBoardId,
});
export type JiraListSprintsInput = typeof JiraListSprintsInput.Type;

export const JiraListSprintsResult = Schema.Struct({
  sprints: Schema.Array(JiraSprint),
});
export type JiraListSprintsResult = typeof JiraListSprintsResult.Type;

export const JiraListIssuesInput = Schema.Struct({
  cloudId: JiraCloudId,
  boardId: Schema.optional(JiraBoardId),
  sprintId: Schema.optional(JiraSprintId),
  query: Schema.optional(Schema.String),
  startAt: Schema.optional(NonNegativeInt),
  maxResults: Schema.optional(NonNegativeInt),
});
export type JiraListIssuesInput = typeof JiraListIssuesInput.Type;

export const JiraListIssuesResult = Schema.Struct({
  issues: Schema.Array(JiraIssue),
  total: NonNegativeInt,
});
export type JiraListIssuesResult = typeof JiraListIssuesResult.Type;

export const JiraGetIssueInput = Schema.Struct({
  cloudId: JiraCloudId,
  issueKey: JiraIssueKey,
});
export type JiraGetIssueInput = typeof JiraGetIssueInput.Type;

export const JiraGetAttachmentInput = Schema.Struct({
  cloudId: JiraCloudId,
  attachmentId: TrimmedNonEmptyString,
});
export type JiraGetAttachmentInput = typeof JiraGetAttachmentInput.Type;

export const JiraGetAttachmentResult = Schema.Struct({
  content: Schema.String,
  mimeType: TrimmedNonEmptyString,
  filename: TrimmedNonEmptyString,
});
export type JiraGetAttachmentResult = typeof JiraGetAttachmentResult.Type;

export class JiraRpcError extends Schema.TaggedErrorClass<JiraRpcError>()("JiraRpcError", {
  message: Schema.String,
}) {}
