import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { WorkSourceProviderName } from "../../../contracts/workSource.ts";
import {
  AsanaProvider,
  GithubIssuesProvider,
  JiraProvider,
  WorkSourceProviderRegistry,
  type WorkSourceProviderRegistryShape,
} from "../Services/WorkSourceProvider.ts";

const make = Effect.gen(function* () {
  const github = yield* GithubIssuesProvider;
  const asana = yield* AsanaProvider;
  const jira = yield* JiraProvider;

  return {
    get: (provider: WorkSourceProviderName) => {
      switch (provider) {
        case "github":
          return github;
        case "asana":
          return asana;
        case "jira":
          return jira;
        default: {
          const unknown: never = provider;
          throw new Error(`Unknown work-source provider: ${String(unknown)}`);
        }
      }
    },
  } satisfies WorkSourceProviderRegistryShape;
});

export const WorkSourceProviderRegistryLive = Layer.effect(WorkSourceProviderRegistry, make);
