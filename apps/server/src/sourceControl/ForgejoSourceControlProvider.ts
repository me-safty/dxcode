import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";

import * as ForgejoApi from "./ForgejoApi.ts";
import * as ForgejoPullRequests from "./forgejoPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import * as SourceControlProviderDiscovery from "./SourceControlProviderDiscovery.ts";

function providerError(
  operation: string,
  cause: ForgejoApi.ForgejoApiError,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "forgejo",
    operation,
    detail: cause.detail,
    cause,
  });
}

function toChangeRequest(
  summary: ForgejoPullRequests.NormalizedForgejoPullRequestRecord,
): ChangeRequest {
  return {
    provider: "forgejo",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state,
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

export function parseForgejoAuthHosts(
  output: string,
): ReadonlyArray<{ readonly account: string; readonly host: string }> {
  const entries: Array<{ account: string; host: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^@\s]+)@([a-z0-9][a-z0-9.-]*(?::\d+)?)$/iu.exec(line.trim());
    if (match?.[1] && match[2]) {
      entries.push({ account: match[1], host: match[2].toLowerCase() });
    }
  }
  return entries;
}

function parseForgejoAuth(input: SourceControlProviderDiscovery.SourceControlAuthProbeInput) {
  const output = SourceControlProviderDiscovery.combinedAuthOutput(input);
  const hosts = parseForgejoAuthHosts(output);
  const first = hosts[0];
  if (first) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "authenticated",
      account: first.account,
      host: first.host,
    });
  }
  if (input.exitCode !== 0) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "unauthenticated",
      detail:
        SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
        "Run `fj auth login <host>` to authenticate the Forgejo CLI.",
    });
  }
  return SourceControlProviderDiscovery.providerAuth({
    status: "unknown",
    detail:
      SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
      "Forgejo CLI auth status could not be parsed.",
  });
}

function refineUnknownForgejoRemote(
  input: SourceControlProviderDiscovery.SourceControlUnknownRemoteRefinementInput,
) {
  const host = input.context.provider.name.toLowerCase();
  const authenticated = parseForgejoAuthHosts(
    SourceControlProviderDiscovery.combinedAuthOutput(input.auth),
  ).some((entry) => ForgejoApi.forgejoHostsMatch(entry.host, host));
  if (!authenticated) return null;
  return {
    kind: "forgejo",
    name: "Forgejo",
    baseUrl: input.context.provider.baseUrl,
  } as const;
}

export const discovery = {
  type: "cli",
  kind: "forgejo",
  label: "Forgejo",
  executable: "fj",
  versionArgs: ["version"],
  authArgs: ["auth", "list"],
  parseAuth: parseForgejoAuth,
  refineUnknownRemote: refineUnknownForgejoRemote,
  installHint:
    "Install the Forgejo CLI (`fj`) from https://codeberg.org/forgejo-contrib/forgejo-cli and run `fj auth login <host>`.",
} satisfies SourceControlProviderDiscovery.SourceControlCliDiscoverySpec;

export const make = Effect.fn("makeForgejoSourceControlProvider")(function* () {
  const forgejo = yield* ForgejoApi.ForgejoApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "forgejo",
    listChangeRequests: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return forgejo
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) => providerError("listChangeRequests", error)),
        );
    },
    getChangeRequest: (input) =>
      forgejo.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", error)),
      ),
    createChangeRequest: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return forgejo
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          ...(input.target ? { target: input.target } : {}),
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", error)));
    },
    getRepositoryCloneUrls: (input) =>
      forgejo
        .getRepositoryCloneUrls(input)
        .pipe(Effect.mapError((error) => providerError("getRepositoryCloneUrls", error))),
    createRepository: (input) =>
      forgejo
        .createRepository(input)
        .pipe(Effect.mapError((error) => providerError("createRepository", error))),
    getDefaultBranch: (input) =>
      forgejo
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", error))),
    checkoutChangeRequest: (input) =>
      forgejo
        .checkoutPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", error))),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());
