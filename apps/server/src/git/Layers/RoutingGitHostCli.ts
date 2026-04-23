/**
 * RoutingGitHostCli – Detects the git hosting provider from the remote URL
 * and delegates all GitHostCli calls to the correct provider implementation
 * (GitHub via `gh` or GitLab via `glab`).
 *
 * Follows the same routing pattern used by `RoutingTextGeneration`.
 *
 * @module RoutingGitHostCli
 */
import { Context, Effect, Layer } from "effect";

import { GitHostCliError } from "@marcode/contracts";
import { runProcess } from "../../processRunner.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { GitHostCli, type GitHostCliShape, type GitHostProvider } from "../Services/GitHostCli.ts";
import { toGitHostCliShape } from "./GitHubCli.ts";
import { makeGitLabCliShape } from "./GitLabCli.ts";

class GitHubHost extends Context.Service<GitHubHost, GitHostCliShape>()(
  "marcode/git/Layers/RoutingGitHostCli/GitHubHost",
) {}

class GitLabHost extends Context.Service<GitLabHost, GitHostCliShape>()(
  "marcode/git/Layers/RoutingGitHostCli/GitLabHost",
) {}

/** @internal */
export function parseHostnameFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const sshMatch = /^(?:ssh:\/\/)?git@([^:/]+)[:/]/i.exec(trimmed);
  if (sshMatch?.[1]) return sshMatch[1].toLowerCase();

  const httpsMatch = /^https?:\/\/([^/]+)/i.exec(trimmed);
  if (httpsMatch?.[1]) return httpsMatch[1].toLowerCase();

  const gitMatch = /^git:\/\/([^/]+)/i.exec(trimmed);
  if (gitMatch?.[1]) return gitMatch[1].toLowerCase();

  return null;
}

/** @internal */
export function providerFromHostname(hostname: string): GitHostProvider | null {
  if (hostname === "github.com") return "github";
  if (hostname === "gitlab.com" || hostname.startsWith("gitlab.")) return "gitlab";
  return null;
}

function checkCliAuthForHost(cliName: string, hostname: string): Effect.Effect<boolean, never> {
  return Effect.tryPromise({
    try: () =>
      runProcess(cliName, ["auth", "status"], {
        timeoutMs: 5_000,
        allowNonZeroExit: true,
      }),
    catch: () =>
      new GitHostCliError({ operation: "checkCliAuthForHost", detail: "CLI auth check failed" }),
  }).pipe(
    Effect.map((result) => {
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      return combined.includes(hostname);
    }),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function probeGitLabApi(hostname: string): Effect.Effect<boolean, never> {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await fetch(`https://${hostname}/api/v4/version`, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "follow",
        });
        return response.status !== 404;
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: () =>
      new GitHostCliError({ operation: "probeGitLabApi", detail: "GitLab API probe failed" }),
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

const providerCache = new Map<string, GitHostProvider>();

const makeRoutingGitHostCli = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const github = yield* GitHubHost;
  const gitlab = yield* GitLabHost;

  const detectProvider = (cwd: string): Effect.Effect<GitHostProvider, GitHostCliError> => {
    const cached = providerCache.get(cwd);
    if (cached) return Effect.succeed(cached);

    return Effect.gen(function* () {
      const remoteUrl = yield* gitCore
        .readConfigValue(cwd, "remote.origin.url")
        .pipe(Effect.catch(() => Effect.succeed(null)));

      const hostname = remoteUrl ? parseHostnameFromRemoteUrl(remoteUrl) : null;

      if (hostname) {
        const wellKnown = providerFromHostname(hostname);
        if (wellKnown) {
          providerCache.set(cwd, wellKnown);
          return wellKnown;
        }
      }

      const explicitConfig = yield* gitCore
        .readConfigValue(cwd, "marcode.gitHostProvider")
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (explicitConfig === "github" || explicitConfig === "gitlab") {
        providerCache.set(cwd, explicitConfig);
        return explicitConfig;
      }

      if (hostname) {
        const [glabAuth, ghAuth] = yield* Effect.all(
          [checkCliAuthForHost("glab", hostname), checkCliAuthForHost("gh", hostname)],
          { concurrency: "unbounded" },
        );

        if (glabAuth && !ghAuth) {
          providerCache.set(cwd, "gitlab");
          return "gitlab" as const;
        }
        if (ghAuth && !glabAuth) {
          providerCache.set(cwd, "github");
          return "github" as const;
        }
        if (ghAuth && glabAuth) {
          providerCache.set(cwd, "github");
          return "github" as const;
        }

        const isGitLab = yield* probeGitLabApi(hostname);
        if (isGitLab) {
          providerCache.set(cwd, "gitlab");
          return "gitlab" as const;
        }
      }

      return yield* new GitHostCliError({
        operation: "detectProvider",
        detail: `Cannot detect git host for ${hostname ?? "unknown hostname"}. Run: git config marcode.gitHostProvider github|gitlab`,
      });
    });
  };

  const resolveImpl = (provider: GitHostProvider): GitHostCliShape =>
    provider === "gitlab" ? gitlab : github;

  const routeMethod = <A extends { cwd: string }, R>(
    method: (impl: GitHostCliShape) => (input: A) => Effect.Effect<R, GitHostCliError>,
    input: A,
  ): Effect.Effect<R, GitHostCliError> =>
    detectProvider(input.cwd).pipe(
      Effect.flatMap((provider) => method(resolveImpl(provider))(input)),
    );

  return {
    provider: "github" as const,
    listPullRequests: (input) => routeMethod((impl) => impl.listPullRequests, input),
    getPullRequest: (input) => routeMethod((impl) => impl.getPullRequest, input),
    getRepositoryCloneUrls: (input) => routeMethod((impl) => impl.getRepositoryCloneUrls, input),
    createPullRequest: (input) => routeMethod((impl) => impl.createPullRequest, input),
    getDefaultBranch: (input) => routeMethod((impl) => impl.getDefaultBranch, input),
    checkoutPullRequest: (input) => routeMethod((impl) => impl.checkoutPullRequest, input),
    pullRequestRefspecPrefix: () => "refs/pull",
    detectedProvider: (input) => detectProvider(input.cwd),
    pullRequestRefspecPrefixForCwd: (input) =>
      detectProvider(input.cwd).pipe(
        Effect.map((provider) => resolveImpl(provider).pullRequestRefspecPrefix()),
      ),
  } satisfies GitHostCliShape;
});

const InternalGitHubLayer = Layer.effect(
  GitHubHost,
  Effect.gen(function* () {
    const ghCli = yield* GitHubCli;
    return toGitHostCliShape(ghCli);
  }),
);

const InternalGitLabLayer = Layer.effect(
  GitLabHost,
  Effect.sync(() => makeGitLabCliShape()),
);

export const RoutingGitHostCliLive = Layer.effect(GitHostCli, makeRoutingGitHostCli).pipe(
  Layer.provide(InternalGitHubLayer),
  Layer.provide(InternalGitLabLayer),
);
