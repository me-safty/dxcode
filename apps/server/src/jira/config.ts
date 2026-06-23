// EMPOWERRD: fork-owned Jira server config. Reads JIRA_DOMAIN / JIRA_PROJECT_KEY
// from the environment at config-assembly time (not deep inside an RPC handler),
// normalizes them, and warns on an invalid project key. The resolved values are
// folded into ServerConfigShape and surfaced to the client via loadServerConfig.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { normalizeJiraDomain, normalizeJiraProjectKey } from "@t3tools/shared/jira";

export interface JiraServerConfig {
  readonly domain: string | null;
  readonly projectKey: string | null;
}

const optionalEnv = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.getOrUndefined));

export const resolveJiraServerConfig = Effect.fn("resolveJiraServerConfig")(function* () {
  const rawDomain = yield* optionalEnv("JIRA_DOMAIN");
  const rawProjectKey = yield* optionalEnv("JIRA_PROJECT_KEY");

  const projectKey = normalizeJiraProjectKey(rawProjectKey);
  if (rawProjectKey !== undefined && rawProjectKey.trim().length > 0 && projectKey === null) {
    yield* Effect.logWarning(
      `JIRA_PROJECT_KEY="${rawProjectKey}" is not a valid project key (must be A-Z/0-9 and start with a letter). The project-key constraint is disabled.`,
    );
  }

  return {
    domain: normalizeJiraDomain(rawDomain),
    projectKey,
  } satisfies JiraServerConfig;
});
