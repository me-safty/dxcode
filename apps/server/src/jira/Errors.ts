import { Data } from "effect";

export class JiraApiError extends Data.TaggedError("JiraApiError")<{
  readonly message: string;
  readonly statusCode?: number;
  readonly ticketKey?: string;
}> {}

export class JiraConfigError extends Data.TaggedError("JiraConfigError")<{
  readonly message: string;
}> {}
