import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ForgejoApi from "./ForgejoApi.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import { vi } from "@effect/vitest";

const forgejoPullRequest = {
  number: 42,
  title: "Add Forgejo provider",
  state: "open",
  merged: false,
  html_url: "https://git.example.org/owner/repo/pulls/42",
  updated_at: "2026-01-02T00:00:00.000Z",
  base: {
    ref: "main",
    repo: { full_name: "owner/repo" },
  },
  head: {
    ref: "feature/forgejo",
    repo: { full_name: "owner/repo" },
  },
};

const repositoryJson = {
  full_name: "owner/repo",
  clone_url: "https://git.example.org/owner/repo.git",
  ssh_url: "git@git.example.org:owner/repo.git",
  html_url: "https://git.example.org/owner/repo",
  default_branch: "main",
};

const keysJson = JSON.stringify({
  hosts: {
    "git.example.org": { type: "Token", name: "owner", token: "t" },
  },
});

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly git?: Partial<GitVcsDriver.GitVcsDriverShape>;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const gitMock = {
    readConfigValue: vi.fn<GitVcsDriver.GitVcsDriverShape["readConfigValue"]>(() =>
      Effect.succeed<string | null>("git@git.example.org:owner/repo.git"),
    ),
    resolvePrimaryRemoteName: vi.fn<GitVcsDriver.GitVcsDriverShape["resolvePrimaryRemoteName"]>(
      () => Effect.succeed("origin"),
    ),
    ensureRemote: vi.fn<GitVcsDriver.GitVcsDriverShape["ensureRemote"]>(() =>
      Effect.succeed("fork-owner"),
    ),
    fetchRemoteBranch: vi.fn<GitVcsDriver.GitVcsDriverShape["fetchRemoteBranch"]>(
      () => Effect.void,
    ),
    fetchRemoteTrackingBranch: vi.fn<GitVcsDriver.GitVcsDriverShape["fetchRemoteTrackingBranch"]>(
      () => Effect.void,
    ),
    setBranchUpstream: vi.fn<GitVcsDriver.GitVcsDriverShape["setBranchUpstream"]>(
      () => Effect.void,
    ),
    switchRef: vi.fn<GitVcsDriver.GitVcsDriverShape["switchRef"]>((request) =>
      Effect.succeed({ refName: request.refName }),
    ),
    listLocalBranchNames: vi.fn<GitVcsDriver.GitVcsDriverShape["listLocalBranchNames"]>(() =>
      Effect.succeed([]),
    ),
  };
  const git = {
    ...gitMock,
    ...input.git,
  } satisfies Partial<GitVcsDriver.GitVcsDriverShape>;

  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: [
          {
            name: "origin",
            url: "git@git.example.org:owner/repo.git",
            pushUrl: Option.none(),
            isPrimary: true,
          },
        ],
        freshness: {
          source: "live-local" as const,
          observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriverShape>;

  // Build layer inside an Effect so we can create the temp keys file
  const layerEffect = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keysPath = yield* fileSystem.makeTempFileScoped({ prefix: "forgejo-keys-" });
    yield* fileSystem.writeFileString(keysPath, keysJson);

    return ForgejoApi.layer.pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          resolve: () =>
            Effect.succeed({
              kind: "git",
              repository: {
                kind: "git",
                rootPath: "/repo",
                metadataPath: null,
                freshness: {
                  source: "live-local" as const,
                  observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                  expiresAt: Option.none(),
                },
              },
              driver: driver as unknown as VcsDriver.VcsDriverShape,
            }),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)(git)),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { T3CODE_FORGEJO_KEYS_PATH: keysPath } }),
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
  });

  return { execute, git: gitMock, layerEffect };
}

it.effect("parses pull request responses from the Forgejo REST API", () =>
  Effect.gen(function* () {
    const { execute, layerEffect } = makeLayer({
      response: () => Response.json(forgejoPullRequest),
    });

    const layer = yield* layerEffect;
    yield* Effect.gen(function* () {
      const forgejo = yield* ForgejoApi.ForgejoApi;
      const result = yield* forgejo.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add Forgejo provider",
        url: "https://git.example.org/owner/repo/pulls/42",
        baseRefName: "main",
        headRefName: "feature/forgejo",
        state: "open",
        updatedAt: Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
      });
      assert.strictEqual(
        execute.mock.calls[0]?.[0].url,
        "https://git.example.org/api/v1/repos/owner/repo/pulls/42",
      );
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("reads repository clone URLs and default branch from Forgejo", () =>
  Effect.gen(function* () {
    const { layerEffect } = makeLayer({
      response: () => Response.json(repositoryJson),
    });

    const layer = yield* layerEffect;
    yield* Effect.gen(function* () {
      const forgejo = yield* ForgejoApi.ForgejoApi;
      const cloneUrls = yield* forgejo.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "git.example.org/owner/repo",
      });
      const defaultBranch = yield* forgejo.getDefaultBranch({ cwd: "/repo" });

      assert.deepStrictEqual(cloneUrls, {
        nameWithOwner: "owner/repo",
        url: "https://git.example.org/owner/repo.git",
        sshUrl: "git@git.example.org:owner/repo.git",
      });
      assert.strictEqual(defaultBranch, "main");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("creates pull requests using the Forgejo REST API payload shape", () =>
  Effect.gen(function* () {
    const { execute, layerEffect } = makeLayer({
      response: () => Response.json(forgejoPullRequest),
    });

    const layer = yield* layerEffect;
    yield* Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const bodyFile = yield* fileSystem.makeTempFileScoped({ prefix: "forgejo-pr-body-" });
      yield* fileSystem.writeFileString(bodyFile, "PR body");

      const forgejo = yield* ForgejoApi.ForgejoApi;
      yield* forgejo.createPullRequest({
        cwd: "/repo",
        baseBranch: "main",
        headSelector: "owner:feature/forgejo",
        title: "Provider PR",
        bodyFile,
      });

      const request = execute.mock.calls[0]?.[0];
      assert.strictEqual(
        request?.url,
        "https://git.example.org/api/v1/repos/owner/repo/pulls",
      );
      assert.strictEqual(request?.method, "POST");
      assert.ok(request);
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      assert.ok(rawBody);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(rawBody)), {
        head: "owner:feature/forgejo",
        base: "main",
        title: "Provider PR",
        body: "PR body",
      });
    }).pipe(Effect.provide(layer), Effect.scoped);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
