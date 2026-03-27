import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";
import { BitbucketApiError } from "../Errors.ts";
import {
  BitbucketApi,
  type BitbucketApiShape,
  type BitbucketPullRequestSummary,
} from "../Services/BitbucketApi.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

interface NetrcCredentials {
  login: string;
  password: string;
}

function readNetrcCredentials(): NetrcCredentials | null {
  try {
    const netrcPath = join(homedir(), ".netrc");
    const content = readFileSync(netrcPath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    let inBitbucket = false;
    let login: string | null = null;
    let password: string | null = null;

    for (const line of lines) {
      if (line.startsWith("machine") && line.includes("bitbucket.org")) {
        inBitbucket = true;
        continue;
      }
      if (inBitbucket && line.startsWith("machine")) {
        break;
      }
      if (inBitbucket) {
        if (line.startsWith("login")) {
          login = line.replace(/^login\s+/, "").trim();
        }
        if (line.startsWith("password")) {
          password = line.replace(/^password\s+/, "").trim();
        }
      }
    }

    if (login && password) {
      return { login, password };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeBitbucketPrState(
  state: string,
): "open" | "closed" | "merged" {
  switch (state.toUpperCase()) {
    case "OPEN":
      return "open";
    case "MERGED":
      return "merged";
    case "DECLINED":
    case "SUPERSEDED":
      return "closed";
    default:
      return "closed";
  }
}

function parsePrSummary(raw: Record<string, unknown>): BitbucketPullRequestSummary | null {
  const id = raw.id;
  const title = raw.title;
  const state = raw.state;
  const links = raw.links as Record<string, unknown> | undefined;
  const source = raw.source as Record<string, unknown> | undefined;
  const destination = raw.destination as Record<string, unknown> | undefined;

  if (typeof id !== "number" || typeof title !== "string" || typeof state !== "string") {
    return null;
  }

  const htmlLink = links?.html as Record<string, unknown> | undefined;
  const url = typeof htmlLink?.href === "string" ? htmlLink.href : "";

  const sourceBranch = source?.branch as Record<string, unknown> | undefined;
  const sourceRefName = typeof sourceBranch?.name === "string" ? sourceBranch.name : "";

  const destBranch = destination?.branch as Record<string, unknown> | undefined;
  const destRefName = typeof destBranch?.name === "string" ? destBranch.name : "";

  return {
    id,
    title,
    url,
    sourceRefName,
    destinationRefName: destRefName,
    state: normalizeBitbucketPrState(state),
  };
}

async function bitbucketFetch(
  path: string,
  options: { method?: string; body?: string; timeoutMs?: number } = {},
): Promise<unknown> {
  const credentials = readNetrcCredentials();
  if (!credentials) {
    throw new Error(
      "Bitbucket credentials not found in ~/.netrc. Add an entry for machine bitbucket.org or api.bitbucket.org with your app password.",
    );
  }

  const url = `${BITBUCKET_API_BASE}${path}`;
  const auth = Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status}: ${text}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBitbucketApiError(
  operation: string,
  error: unknown,
): BitbucketApiError {
  if (error instanceof Error) {
    if (error.message.includes("credentials not found")) {
      return new BitbucketApiError({
        operation,
        detail:
          "Bitbucket credentials not configured. Add to ~/.netrc:\n  machine bitbucket.org\n    login your@email.com\n    password YOUR_APP_PASSWORD",
        cause: error,
      });
    }
    if (error.message.includes("401") || error.message.includes("403")) {
      return new BitbucketApiError({
        operation,
        detail: "Bitbucket authentication failed. Check your app password in ~/.netrc.",
        cause: error,
      });
    }
    if (error.message.includes("404")) {
      return new BitbucketApiError({
        operation,
        detail: "Bitbucket resource not found. Check workspace and repository names.",
        cause: error,
      });
    }
    return new BitbucketApiError({
      operation,
      detail: `Bitbucket API call failed: ${error.message}`,
      cause: error,
    });
  }
  return new BitbucketApiError({
    operation,
    detail: "Bitbucket API call failed.",
    cause: error,
  });
}

const makeBitbucketApi = Effect.sync(() => {
  const service: BitbucketApiShape = {
    listOpenPullRequests: (input) =>
      Effect.tryPromise({
        try: async () => {
          const q = encodeURIComponent(
            `source.branch.name="${input.sourceBranch}" AND state="OPEN"`,
          );
          const limit = input.limit ?? 10;
          const data = (await bitbucketFetch(
            `/repositories/${input.workspace}/${input.repoSlug}/pullrequests?q=${q}&pagelen=${limit}`,
          )) as { values?: unknown[] };
          const values = Array.isArray(data.values) ? data.values : [];
          return values
            .map((v) => parsePrSummary(v as Record<string, unknown>))
            .filter((v): v is BitbucketPullRequestSummary => v !== null);
        },
        catch: (error) => normalizeBitbucketApiError("listOpenPullRequests", error),
      }),

    listAllPullRequests: (input) =>
      Effect.tryPromise({
        try: async () => {
          const q = encodeURIComponent(
            `source.branch.name="${input.sourceBranch}"`,
          );
          const limit = input.limit ?? 20;
          const data = (await bitbucketFetch(
            `/repositories/${input.workspace}/${input.repoSlug}/pullrequests?q=${q}&pagelen=${limit}&sort=-updated_on`,
          )) as { values?: unknown[] };
          const values = Array.isArray(data.values) ? data.values : [];
          return values
            .map((v) => parsePrSummary(v as Record<string, unknown>))
            .filter((v): v is BitbucketPullRequestSummary => v !== null);
        },
        catch: (error) => normalizeBitbucketApiError("listAllPullRequests", error),
      }),

    getPullRequest: (input) =>
      Effect.tryPromise({
        try: async () => {
          const data = (await bitbucketFetch(
            `/repositories/${input.workspace}/${input.repoSlug}/pullrequests/${input.prId}`,
          )) as Record<string, unknown>;
          const pr = parsePrSummary(data);
          if (!pr) {
            throw new Error(`Failed to parse PR #${input.prId}`);
          }
          return pr;
        },
        catch: (error) => normalizeBitbucketApiError("getPullRequest", error),
      }),

    createPullRequest: (input) =>
      Effect.tryPromise({
        try: async () => {
          const body = JSON.stringify({
            title: input.title,
            description: input.description,
            source: { branch: { name: input.sourceBranch } },
            destination: { branch: { name: input.destinationBranch } },
            close_source_branch: true,
          });
          const data = (await bitbucketFetch(
            `/repositories/${input.workspace}/${input.repoSlug}/pullrequests`,
            { method: "POST", body },
          )) as Record<string, unknown>;
          const pr = parsePrSummary(data);
          if (!pr) {
            throw new Error("Failed to parse created PR response");
          }
          return pr;
        },
        catch: (error) => normalizeBitbucketApiError("createPullRequest", error),
      }),

    getDefaultBranch: (input) =>
      Effect.tryPromise({
        try: async () => {
          const data = (await bitbucketFetch(
            `/repositories/${input.workspace}/${input.repoSlug}`,
          )) as { mainbranch?: { name?: string } };
          return data.mainbranch?.name ?? null;
        },
        catch: (error) => normalizeBitbucketApiError("getDefaultBranch", error),
      }),
  };

  return service;
});

export const BitbucketApiLive = Layer.effect(BitbucketApi, makeBitbucketApi);
