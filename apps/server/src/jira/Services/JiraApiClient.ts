import { Context, Effect } from "effect";
import type {
  JiraConnectionStatus,
  JiraGetAttachmentInput,
  JiraGetAttachmentResult,
  JiraGetIssueInput,
  JiraIssue,
  JiraListBoardsInput,
  JiraListBoardsResult,
  JiraListIssuesInput,
  JiraListIssuesResult,
  JiraListSprintsInput,
  JiraListSprintsResult,
  JiraSite,
} from "@marcode/contracts";
import { JiraApiError, JiraTokenError } from "../Errors.ts";

export interface JiraApiClientShape {
  readonly getConnectionStatus: Effect.Effect<JiraConnectionStatus, JiraApiError | JiraTokenError>;
  readonly getAccessibleResources: Effect.Effect<
    ReadonlyArray<JiraSite>,
    JiraApiError | JiraTokenError
  >;
  readonly listBoards: (
    input: JiraListBoardsInput,
  ) => Effect.Effect<JiraListBoardsResult, JiraApiError | JiraTokenError>;
  readonly listSprints: (
    input: JiraListSprintsInput,
  ) => Effect.Effect<JiraListSprintsResult, JiraApiError | JiraTokenError>;
  readonly listIssues: (
    input: JiraListIssuesInput,
  ) => Effect.Effect<JiraListIssuesResult, JiraApiError | JiraTokenError>;
  readonly getIssue: (
    input: JiraGetIssueInput,
  ) => Effect.Effect<JiraIssue, JiraApiError | JiraTokenError>;
  readonly getAttachment: (
    input: JiraGetAttachmentInput,
  ) => Effect.Effect<JiraGetAttachmentResult, JiraApiError | JiraTokenError>;
  readonly disconnect: Effect.Effect<void, JiraApiError | JiraTokenError>;
}

export class JiraApiClient extends Context.Service<JiraApiClient, JiraApiClientShape>()(
  "marcode/jira/JiraApiClient",
) {}
