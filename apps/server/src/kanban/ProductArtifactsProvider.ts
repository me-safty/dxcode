import { Context, Effect, Layer, Schema } from "effect";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import nodePath from "node:path";
import type {
  KanbanConsoleArtifact,
  KanbanConsoleArtifactContent,
  KanbanConsoleArtifactStatus,
  KanbanConsoleArtifactWriteRequest,
  KanbanConsoleArtifactWriteResult,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";

const PRODUCT_DOCS_ROOT = "docs/product";
const DEFAULT_TIMEOUT_MS = 30_000;

export class ProductArtifactsProviderError extends Schema.TaggedErrorClass<ProductArtifactsProviderError>()(
  "ProductArtifactsProviderError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Product artifacts provider failed in ${this.operation}: ${this.detail}`;
  }
}

export interface ProductArtifactPathInput {
  readonly repoId: string;
  readonly cwd: string;
  readonly path: string;
}

export interface ProductArtifactsProviderShape {
  readonly listArtifacts: (input: {
    readonly repoId: string;
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<KanbanConsoleArtifact>, ProductArtifactsProviderError>;
  readonly readArtifact: (
    input: ProductArtifactPathInput,
  ) => Effect.Effect<KanbanConsoleArtifactContent, ProductArtifactsProviderError>;
  readonly writeArtifact: (
    input: KanbanConsoleArtifactWriteRequest,
  ) => Effect.Effect<KanbanConsoleArtifactWriteResult, ProductArtifactsProviderError>;
}

export class ProductArtifactsProvider extends Context.Service<
  ProductArtifactsProvider,
  ProductArtifactsProviderShape
>()("t3/kanban/ProductArtifactsProvider") {}

function providerError(operation: string, cause: unknown): ProductArtifactsProviderError {
  return new ProductArtifactsProviderError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function confinedMarkdownPath(input: {
  readonly cwd: string;
  readonly path: string;
}): Effect.Effect<
  { readonly relativePath: string; readonly absolutePath: string; readonly rootPath: string },
  ProductArtifactsProviderError
> {
  const relativePath = normalizeRelativePath(input.path);
  const rootPath = nodePath.resolve(input.cwd, PRODUCT_DOCS_ROOT);
  const absolutePath = nodePath.resolve(input.cwd, relativePath);
  const isInsideRoot =
    absolutePath === rootPath || absolutePath.startsWith(`${rootPath}${nodePath.sep}`);

  if (
    nodePath.isAbsolute(input.path) ||
    !relativePath.startsWith(`${PRODUCT_DOCS_ROOT}/`) ||
    !relativePath.endsWith(".md") ||
    !isInsideRoot
  ) {
    return Effect.fail(
      new ProductArtifactsProviderError({
        operation: "pathConfinement",
        detail: "Product artifacts must be Markdown files under docs/product.",
      }),
    );
  }

  return Effect.succeed({ relativePath, absolutePath, rootPath });
}

function titleFromMarkdown(relativePath: string, content: string): string {
  const heading = content
    .split(/\r?\n/g)
    .map((line) => /^#\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .find((line): line is string => Boolean(line));
  if (heading) return heading;
  return nodePath.basename(relativePath, ".md").replace(/[-_]+/g, " ");
}

function markdownPreview(content: string): string {
  return content
    .split(/\r?\n/g)
    .map((line) => line.replace(/^#{1,6}\s+/u, "").replace(/[*_`]/g, ""))
    .join("\n")
    .trim();
}

function statusFromPorcelain(output: string): KanbanConsoleArtifactStatus {
  const lines = output.split(/\r?\n/g).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "clean";
  return lines.some((line) => line.slice(0, 2).includes("U")) ? "conflict" : "dirty";
}

function artifactId(repoId: string, relativePath: string): string {
  return `${repoId}:${relativePath}`;
}

function readPathStatus(
  git: GitVcsDriver.GitVcsDriverShape,
  input: { readonly cwd: string; readonly relativePath: string },
) {
  return git
    .execute({
      operation: "ProductArtifactsProvider.status",
      cwd: input.cwd,
      args: ["status", "--porcelain=v1", "--", input.relativePath],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
    .pipe(Effect.map((result) => statusFromPorcelain(result.stdout)));
}

function readMarkdownFile(input: {
  readonly absolutePath: string;
}): Effect.Effect<string, ProductArtifactsProviderError> {
  return Effect.tryPromise({
    try: () => readFile(input.absolutePath, "utf8"),
    catch: (cause) => providerError("readFile", cause),
  });
}

function readFileUpdatedAt(input: {
  readonly absolutePath: string;
}): Effect.Effect<string, ProductArtifactsProviderError> {
  return Effect.tryPromise({
    try: () => stat(input.absolutePath),
    catch: (cause) => providerError("stat", cause),
  }).pipe(Effect.map((stats) => stats.mtime.toISOString()));
}

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = nodePath.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function branchIsProtected(branch: string): boolean {
  return branch === "main" || branch.startsWith("release/");
}

function artifactEditComment(input: { readonly path: string; readonly target: string }): string {
  return [
    "Kanban Console artifact update",
    "",
    `- Artifact: \`${input.path}\``,
    `- Target: ${input.target}`,
    "- Summary: Product artifact content was updated through the guarded docs/product flow.",
    "- Raw diff and command output intentionally omitted.",
  ].join("\n");
}

export const make = Effect.fn("ProductArtifactsProvider.make")(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const github = yield* GitHubCli.GitHubCli;

  const readArtifact = Effect.fn("ProductArtifactsProvider.readArtifact")(function* (
    input: ProductArtifactPathInput,
  ) {
    const confined = yield* confinedMarkdownPath(input);
    const [content, updatedAt, status] = yield* Effect.all(
      [
        readMarkdownFile(confined),
        readFileUpdatedAt(confined),
        readPathStatus(git, { cwd: input.cwd, relativePath: confined.relativePath }),
      ],
      { concurrency: "unbounded" },
    );

    return {
      repoId: input.repoId,
      path: confined.relativePath,
      title: titleFromMarkdown(confined.relativePath, content),
      status,
      updatedAt,
      content,
      preview: markdownPreview(content),
    } satisfies KanbanConsoleArtifactContent;
  });

  return ProductArtifactsProvider.of({
    listArtifacts: (input) =>
      Effect.gen(function* () {
        const rootPath = nodePath.resolve(input.cwd, PRODUCT_DOCS_ROOT);
        const files = yield* Effect.tryPromise({
          try: () => listMarkdownFiles(rootPath),
          catch: (cause) => providerError("listArtifacts", cause),
        });

        const artifacts = yield* Effect.all(
          files.map((absolutePath) => {
            const relativePath = normalizeRelativePath(nodePath.relative(input.cwd, absolutePath));
            return readArtifact({ repoId: input.repoId, cwd: input.cwd, path: relativePath }).pipe(
              Effect.map(
                (artifact): KanbanConsoleArtifact => ({
                  id: artifactId(input.repoId, artifact.path),
                  repoId: input.repoId,
                  path: artifact.path,
                  title: artifact.title,
                  status: artifact.status,
                  updatedAt: artifact.updatedAt,
                }),
              ),
            );
          }),
          { concurrency: 4 },
        );

        return artifacts.toSorted((a, b) => a.path.localeCompare(b.path));
      }).pipe(Effect.mapError((error) => providerError("listArtifacts", error))),

    readArtifact: (input) =>
      readArtifact(input).pipe(Effect.mapError((error) => providerError("readArtifact", error))),

    writeArtifact: (input) =>
      Effect.gen(function* () {
        const confined = yield* confinedMarkdownPath(input);
        if (!input.confirmed) {
          return {
            repoId: input.repoId,
            path: confined.relativePath,
            status: "blocked",
            message: "Artifact edits require explicit confirmation.",
          } satisfies KanbanConsoleArtifactWriteResult;
        }

        const [details, currentStatus] = yield* Effect.all(
          [
            git.statusDetails(input.cwd),
            readPathStatus(git, { cwd: input.cwd, relativePath: confined.relativePath }),
          ],
          { concurrency: "unbounded" },
        );
        const branch = details.branch ?? "DETACHED";
        if (branchIsProtected(branch)) {
          return {
            repoId: input.repoId,
            path: confined.relativePath,
            status: "blocked",
            message: `Artifact edits are blocked on protected branch ${branch}.`,
          } satisfies KanbanConsoleArtifactWriteResult;
        }
        if (currentStatus !== "clean") {
          return {
            repoId: input.repoId,
            path: confined.relativePath,
            status: "blocked",
            message: `Artifact ${confined.relativePath} is ${currentStatus}; resolve local changes first.`,
          } satisfies KanbanConsoleArtifactWriteResult;
        }

        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(nodePath.dirname(confined.absolutePath), { recursive: true });
            await writeFile(confined.absolutePath, input.content, "utf8");
          },
          catch: (cause) => providerError("writeArtifact", cause),
        });

        const targetNumber = input.linkedPullRequestNumber ?? input.linkedIssueNumber;
        const targetKind = input.linkedPullRequestNumber ? "pr" : "issue";
        const commentTarget =
          input.linkedRepository && targetNumber !== undefined
            ? `${targetKind}#${targetNumber}`
            : undefined;

        const commentPosted =
          input.linkedRepository && targetNumber !== undefined
            ? yield* Effect.exit(
                github.execute({
                  cwd: input.cwd,
                  args: [
                    "issue",
                    "comment",
                    String(targetNumber),
                    "--repo",
                    input.linkedRepository,
                    "--body",
                    artifactEditComment({
                      path: confined.relativePath,
                      target: commentTarget ?? "linked work item",
                    }),
                  ],
                  timeoutMs: DEFAULT_TIMEOUT_MS,
                }),
              ).pipe(Effect.map((exit) => exit._tag === "Success"))
            : false;

        return {
          repoId: input.repoId,
          path: confined.relativePath,
          status: "applied",
          message:
            input.linkedRepository && targetNumber !== undefined && !commentPosted
              ? "Artifact updated through the guarded docs/product flow; GitHub comment posting failed."
              : "Artifact updated through the guarded docs/product flow.",
          ...(commentTarget && commentPosted ? { commentTarget } : {}),
        } satisfies KanbanConsoleArtifactWriteResult;
      }).pipe(Effect.mapError((error) => providerError("writeArtifact", error))),
  });
});

export const layer = Layer.effect(ProductArtifactsProvider, make());
