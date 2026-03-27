import { ServiceMap, Effect } from "effect";
import type { JiraTicket } from "@t3tools/contracts";
import type { JiraApiError, JiraConfigError } from "../Errors.ts";

export interface JiraServiceShape {
  readonly listTickets: (input: {
    readonly assignee?: string;
    readonly status?: string;
    readonly maxResults?: number;
  }) => Effect.Effect<ReadonlyArray<JiraTicket>, JiraApiError | JiraConfigError>;

  readonly getTicket: (input: {
    readonly ticketKey: string;
  }) => Effect.Effect<JiraTicket, JiraApiError | JiraConfigError>;

  readonly searchTickets: (input: {
    readonly jql: string;
    readonly maxResults?: number;
  }) => Effect.Effect<ReadonlyArray<JiraTicket>, JiraApiError | JiraConfigError>;

  readonly postComment: (input: {
    readonly ticketKey: string;
    readonly body: string;
  }) => Effect.Effect<void, JiraApiError | JiraConfigError>;

  readonly refreshCache: () => Effect.Effect<{ count: number }, JiraApiError | JiraConfigError>;

  readonly transitionTicket: (input: {
    readonly ticketKey: string;
    readonly transitionName: string;
  }) => Effect.Effect<void, JiraApiError | JiraConfigError>;

  readonly listServiceDeskRequestTypes: () => Effect.Effect<
    ReadonlyArray<{ id: string; name: string; description?: string }>,
    JiraApiError | JiraConfigError
  >;

  readonly createServiceDeskRequest: (input: {
    readonly requestTypeId: string;
    readonly summary: string;
    readonly description?: string;
  }) => Effect.Effect<{ issueKey: string; url: string }, JiraApiError | JiraConfigError>;
}

export class JiraService extends ServiceMap.Service<JiraService, JiraServiceShape>()(
  "t3/jira/Services/JiraService",
) {}
