import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { type IntegrationAccountTokenValidationInput } from "@t3tools/contracts";

import { testIntegrationToken } from "./integrations.ts";

function makeHttpClient(response: Response) {
  return HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, response)),
  );
}

function provideHttpClient<T extends IntegrationAccountTokenValidationInput>(
  input: T,
  response: Response,
) {
  return testIntegrationToken(input).pipe(
    Effect.provideService(HttpClient.HttpClient, makeHttpClient(response)),
  );
}

describe("testIntegrationToken", () => {
  it.effect("verifies GitHub user tokens", () =>
    Effect.gen(function* () {
      const result = yield* provideHttpClient(
        { kind: "github", apiKey: "ghp_test" },
        Response.json({ login: "octocat", name: "Monalisa Octocat", email: null }, { status: 200 }),
      );

      expect(result.accountLabel).toBe("Monalisa Octocat");
    }),
  );

  it.effect("verifies GitLab user tokens", () =>
    Effect.gen(function* () {
      const result = yield* provideHttpClient(
        { kind: "gitlab", apiKey: "glpat_test" },
        Response.json({ username: "octocat", name: "Monalisa Octocat" }, { status: 200 }),
      );

      expect(result.accountLabel).toBe("Monalisa Octocat");
    }),
  );

  it.effect("verifies Jira tokens against the configured base URL", () =>
    Effect.gen(function* () {
      const result = yield* provideHttpClient(
        {
          kind: "jira",
          baseUrl: "https://jira.example.test",
          apiKey: "jira_token",
        },
        Response.json(
          { displayName: "Jira User", emailAddress: "jira@example.test" },
          { status: 200 },
        ),
      );

      expect(result.accountLabel).toBe("Jira User");
    }),
  );

  it.effect("verifies Linear API keys", () =>
    Effect.gen(function* () {
      const result = yield* provideHttpClient(
        { kind: "linear", apiKey: "lin_test" },
        Response.json({ data: { viewer: { name: "Linear User", email: null } } }, { status: 200 }),
      );

      expect(result.accountLabel).toBe("Linear User");
    }),
  );
});
