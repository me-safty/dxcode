import { Context, Effect, Layer, Schema, SchemaIssue } from "effect";
import type {
  KanbanColumnId,
  KanbanConsoleProjectBoard,
  KanbanConsoleTask,
  KanbanConsoleTaskTransitionResult,
} from "@t3tools/contracts";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PROJECT_ITEM_LIMIT = 100;

const UnknownJson = Schema.Unknown;
const RawProjectList = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      number: Schema.Number,
      title: Schema.String,
      url: Schema.optional(Schema.String),
      closed: Schema.optional(Schema.Boolean),
    }),
  ),
});

const RawProjectFields = Schema.Struct({
  fields: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.optional(Schema.String),
      options: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
          }),
        ),
      ),
    }),
  ),
});

export interface GitHubProjectSummary {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url?: string;
  readonly closed: boolean;
}

export interface GitHubProjectFieldOption {
  readonly id: string;
  readonly name: string;
}

export interface GitHubProjectField {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly options: ReadonlyArray<GitHubProjectFieldOption>;
}

export interface GitHubProjectsAuthReadiness {
  readonly status: "authenticated" | "setup-required";
  readonly detail: string;
}

export interface GitHubProjectItemStatusUpdate {
  readonly itemId: string;
  readonly fromColumn: KanbanColumnId;
  readonly toColumn: KanbanColumnId;
  readonly confirmed: boolean;
  readonly projectId: string;
  readonly statusFieldId: string;
  readonly statusOptionId: string;
}

export class GitHubProjectsProviderError extends Schema.TaggedErrorClass<GitHubProjectsProviderError>()(
  "GitHubProjectsProviderError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `GitHub Projects provider failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GitHubProjectsProviderShape {
  readonly checkAuthReadiness: (input: {
    readonly cwd: string;
  }) => Effect.Effect<GitHubProjectsAuthReadiness, never>;

  readonly listProjects: (input: {
    readonly cwd: string;
    readonly owner: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubProjectSummary>, GitHubProjectsProviderError>;

  readonly listProjectFields: (input: {
    readonly cwd: string;
    readonly owner: string;
    readonly projectNumber: number;
  }) => Effect.Effect<ReadonlyArray<GitHubProjectField>, GitHubProjectsProviderError>;

  readonly listProjectItems: (input: {
    readonly cwd: string;
    readonly owner: string;
    readonly projectNumber: number;
    readonly projectTitle: string;
    readonly projectId: string;
    readonly limit?: number;
  }) => Effect.Effect<
    { readonly board: KanbanConsoleProjectBoard; readonly tasks: ReadonlyArray<KanbanConsoleTask> },
    GitHubProjectsProviderError
  >;

  readonly updateProjectItemStatus: (
    input: GitHubProjectItemStatusUpdate & { readonly cwd: string },
  ) => Effect.Effect<KanbanConsoleTaskTransitionResult, GitHubProjectsProviderError>;

  readonly postStatusMoveComment: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly issueNumber: number;
    readonly body: string;
    readonly confirmed: boolean;
  }) => Effect.Effect<void, GitHubProjectsProviderError>;
}

export class GitHubProjectsProvider extends Context.Service<
  GitHubProjectsProvider,
  GitHubProjectsProviderShape
>()("t3/kanban/GitHubProjectsProvider") {}

function decodeJson<S extends Schema.Top>(
  operation: string,
  raw: string,
  schema: S,
): Effect.Effect<S["Type"], GitHubProjectsProviderError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubProjectsProviderError({
          operation,
          detail: `GitHub CLI returned invalid JSON: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

function providerError(
  operation: string,
  cause: GitHubCli.GitHubCliError,
): GitHubProjectsProviderError {
  return new GitHubProjectsProviderError({
    operation,
    detail: cause.detail,
    cause,
  });
}

function trim(input: unknown): string | null {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : null;
}

function numberValue(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function objectValue(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function arrayValue(input: unknown): ReadonlyArray<unknown> {
  return Array.isArray(input) ? input : [];
}

function fieldValue(item: Record<string, unknown>, names: ReadonlyArray<string>): unknown {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const rawField of arrayValue(item.fieldValues)) {
    const field = objectValue(rawField);
    if (!field) continue;
    const name = trim(field.name) ?? trim(objectValue(field.field)?.name);
    if (name && wanted.has(name.toLowerCase())) {
      return field.value ?? field.name ?? field.text ?? field.title;
    }
  }

  for (const name of names) {
    if (name in item) return item[name];
  }

  return undefined;
}

function toColumn(value: unknown): KanbanColumnId {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (["backlog", "icebox"].includes(normalized)) return "backlog";
  if (["ready", "todo", "to-do"].includes(normalized)) return "ready";
  if (["in-progress", "doing", "active"].includes(normalized)) return "in-progress";
  if (["review", "in-review", "pr-review"].includes(normalized)) return "review";
  if (["blocked", "blocker"].includes(normalized)) return "blocked";
  if (["done", "complete", "completed", "closed"].includes(normalized)) return "done";
  return "backlog";
}

function toPriority(value: unknown): KanbanConsoleTask["priority"] {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalized === "P0" || normalized === "P1" || normalized === "P2" ? normalized : "P2";
}

function toAgent(value: unknown): KanbanConsoleTask["agent"] {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "codex") return "Codex";
  if (normalized === "claude") return "Claude";
  return "Human";
}

function repoName(content: Record<string, unknown> | null, fallbackOwner: string): string {
  const repository = objectValue(content?.repository);
  const nameWithOwner = trim(repository?.nameWithOwner);
  if (nameWithOwner) return nameWithOwner.split("/").at(-1) ?? nameWithOwner;
  return trim(repository?.name) ?? trim(content?.repo) ?? fallbackOwner;
}

function issueLabel(content: Record<string, unknown> | null, repo: string): string {
  const number = numberValue(content?.number);
  return number === null ? `${repo}#unknown` : `${repo}#${number}`;
}

function assigneeName(
  content: Record<string, unknown> | null,
  item: Record<string, unknown>,
): string {
  const assignees = arrayValue(content?.assignees);
  const firstAssignee = objectValue(assignees[0]);
  return (
    trim(firstAssignee?.login) ??
    trim(firstAssignee?.name) ??
    trim(fieldValue(item, ["Assignee"])) ??
    "Unassigned"
  );
}

function linkedPullRequest(item: Record<string, unknown>): string | undefined {
  const direct = trim(fieldValue(item, ["Pull Request", "Pull Requests", "PR", "Linked PR"]));
  if (direct) return direct;

  for (const rawField of arrayValue(item.fieldValues)) {
    const field = objectValue(rawField);
    const value = trim(field?.value) ?? trim(field?.text) ?? trim(field?.title);
    if (value && /#\d+/u.test(value)) return value;
  }

  return undefined;
}

function mapItemToTask(item: Record<string, unknown>, owner: string): KanbanConsoleTask | null {
  const content = objectValue(item.content);
  const title = trim(content?.title) ?? trim(item.title);
  if (!title) return null;

  const repo = repoName(content, owner);
  const comments =
    numberValue(content?.comments) ?? numberValue(fieldValue(item, ["Comments"])) ?? 0;
  const updatedAt = trim(content?.updatedAt) ?? trim(item.updatedAt) ?? new Date(0).toISOString();

  return {
    id: trim(item.id) ?? `${repo}-${issueLabel(content, repo)}`,
    issue: issueLabel(content, repo),
    title,
    titleAr: title,
    repo,
    column: toColumn(fieldValue(item, ["Status", "status"])),
    priority: toPriority(fieldValue(item, ["Priority", "priority"])),
    assignee: assigneeName(content, item),
    ...(linkedPullRequest(item) ? { pr: linkedPullRequest(item) } : {}),
    checks: { passing: 0, pending: 0, failing: 0 },
    agent: toAgent(fieldValue(item, ["Agent", "Owner"])),
    updated: updatedAt,
    comments,
  };
}

export const make = Effect.fn("makeGitHubProjectsProvider")(function* () {
  const github = yield* GitHubCli.GitHubCli;

  return GitHubProjectsProvider.of({
    checkAuthReadiness: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: ["auth", "status"],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({
              status: "setup-required" as const,
              detail: error.detail,
            }),
            onSuccess: () => ({
              status: "authenticated" as const,
              detail: "GitHub CLI is authenticated.",
            }),
          }),
        ),

    listProjects: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: [
            "project",
            "list",
            "--owner",
            input.owner,
            "--limit",
            String(input.limit ?? 20),
            "--format",
            "json",
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) => decodeJson("listProjects", raw, RawProjectList)),
          Effect.map((decoded) =>
            decoded.projects.map((project) => ({
              id: project.id.trim(),
              number: project.number,
              title: project.title.trim(),
              ...(project.url ? { url: project.url.trim() } : {}),
              closed: project.closed ?? false,
            })),
          ),
          Effect.mapError((error) =>
            Schema.is(GitHubProjectsProviderError)(error)
              ? error
              : providerError("listProjects", error),
          ),
        ),

    listProjectFields: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: [
            "project",
            "field-list",
            String(input.projectNumber),
            "--owner",
            input.owner,
            "--format",
            "json",
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) => decodeJson("listProjectFields", raw, RawProjectFields)),
          Effect.map((decoded) =>
            decoded.fields.map((field) => ({
              id: field.id.trim(),
              name: field.name.trim(),
              ...(field.type ? { type: field.type.trim() } : {}),
              options: (field.options ?? []).map((option) => ({
                id: option.id.trim(),
                name: option.name.trim(),
              })),
            })),
          ),
          Effect.mapError((error) =>
            Schema.is(GitHubProjectsProviderError)(error)
              ? error
              : providerError("listProjectFields", error),
          ),
        ),

    listProjectItems: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: [
            "project",
            "item-list",
            String(input.projectNumber),
            "--owner",
            input.owner,
            "--limit",
            String(input.limit ?? DEFAULT_PROJECT_ITEM_LIMIT),
            "--format",
            "json",
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            decodeJson(
              "listProjectItems",
              raw,
              Schema.Struct({ items: Schema.Array(UnknownJson) }),
            ),
          ),
          Effect.map((decoded) => {
            const tasks = decoded.items
              .map(objectValue)
              .filter((item): item is Record<string, unknown> => item !== null)
              .map((item) => mapItemToTask(item, input.owner))
              .filter((task): task is KanbanConsoleTask => task !== null);

            return {
              board: {
                id: input.projectId,
                owner: input.owner,
                title: input.projectTitle,
                source: "github-projects" as const,
                columns: ["backlog", "ready", "in-progress", "review", "blocked", "done"] as const,
              },
              tasks,
            };
          }),
          Effect.mapError((error) =>
            Schema.is(GitHubProjectsProviderError)(error)
              ? error
              : providerError("listProjectItems", error),
          ),
        ),

    updateProjectItemStatus: (input) => {
      if (!input.confirmed) {
        return Effect.fail(
          new GitHubProjectsProviderError({
            operation: "updateProjectItemStatus",
            detail: "GitHub Project status updates require explicit confirmation.",
          }),
        );
      }

      return github
        .execute({
          cwd: input.cwd,
          args: [
            "project",
            "item-edit",
            "--id",
            input.itemId,
            "--project-id",
            input.projectId,
            "--field-id",
            input.statusFieldId,
            "--single-select-option-id",
            input.statusOptionId,
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.as({
            taskId: input.itemId,
            fromColumn: input.fromColumn,
            toColumn: input.toColumn,
            action: "none" as const,
            requiresConfirmation: false,
            duplicateSuppressed: false,
            message: "GitHub Project status updated.",
          }),
          Effect.mapError((error) => providerError("updateProjectItemStatus", error)),
        );
    },

    postStatusMoveComment: (input) => {
      if (!input.confirmed) {
        return Effect.fail(
          new GitHubProjectsProviderError({
            operation: "postStatusMoveComment",
            detail: "GitHub issue comments for status moves require explicit confirmation.",
          }),
        );
      }

      return github
        .execute({
          cwd: input.cwd,
          args: [
            "issue",
            "comment",
            String(input.issueNumber),
            "--repo",
            input.repository,
            "--body",
            input.body,
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => providerError("postStatusMoveComment", error)),
        );
    },
  });
});

export const layer = Layer.effect(GitHubProjectsProvider, make());
