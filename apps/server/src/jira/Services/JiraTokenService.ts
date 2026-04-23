import { Context, Effect, Option, Stream } from "effect";
import { JiraTokenError } from "../Errors.ts";

export interface JiraTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
}

export interface JiraTokenServiceShape {
  readonly getTokens: Effect.Effect<Option.Option<JiraTokenSet>, JiraTokenError>;
  readonly saveTokens: (tokens: JiraTokenSet) => Effect.Effect<void, JiraTokenError>;
  readonly clearTokens: Effect.Effect<void, JiraTokenError>;
  readonly getValidAccessToken: Effect.Effect<string, JiraTokenError>;
  readonly streamChanges: Stream.Stream<Option.Option<JiraTokenSet>>;
}

export class JiraTokenService extends Context.Service<JiraTokenService, JiraTokenServiceShape>()(
  "marcode/jira/JiraTokenService",
) {}
