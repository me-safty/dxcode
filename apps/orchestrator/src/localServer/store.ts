import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ModelSelection, UploadChatAttachment } from "@t3tools/contracts";

import { extractGitHubPullRequests } from "../github/prDiscovery.ts";
import type { TaskIntakeMessage } from "../taskIntake/contracts.ts";
import type {
  TaskIntakeExistingTask,
  TaskIntakeProjectOption,
  TaskIntakeStoredEvent,
} from "../taskIntake/ports.ts";
import { resolveMentionedProject } from "../taskIntake/projectRouting.ts";

type TaskStatus =
  | "ready"
  | "working"
  | "needs_input"
  | "ready_for_review"
  | "done"
  | "blocked"
  | "failed"
  | "canceled";

type WorkSessionStatus =
  | "requested"
  | "accepted"
  | "started"
  | "completed"
  | "failed"
  | "interrupted"
  | "superseded";

export interface ProjectRecord extends TaskIntakeProjectOption {
  readonly workspaceRoot: string;
  readonly defaultBranch: string;
  readonly t3ProjectId?: string;
}

export interface UpsertProjectInput {
  readonly repoName: string;
  readonly workspaceRoot?: string;
  readonly defaultBranch: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly linearTeamId?: string;
  readonly linearProjectId?: string;
  readonly t3ProjectId?: string;
}

export interface TaskRuntimeMaterialization {
  readonly taskId: string;
  readonly workSessionId: string;
  readonly t3ProjectId: string;
  readonly t3ThreadId: string;
  readonly environmentId?: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly acceptedAt: string;
}

interface ProjectRow {
  readonly id: string;
  readonly repoName: string;
  readonly workspaceRoot: string | null;
  readonly defaultBranch: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly t3ProjectId: string | null;
}

interface TaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly statusReason: string | null;
  readonly currentPrimaryTaskThreadId: string | null;
}

interface TaskThreadRow {
  readonly id: string;
  readonly t3ThreadId: string;
  readonly worktreePath: string | null;
}

interface WorkSessionRow {
  readonly id: string;
  readonly taskId: string;
  readonly taskThreadId: string;
  readonly t3ThreadId: string;
  readonly status: WorkSessionStatus;
}

interface ExternalLinkRow {
  readonly id: string;
  readonly taskId: string;
  readonly kind: string;
  readonly externalId: string;
  readonly url: string | null;
  readonly muted: number;
}

export interface LocalChatSdkStateOps {
  readonly subscribe: (threadId: string) => Promise<void>;
  readonly unsubscribe: (threadId: string) => Promise<void>;
  readonly isSubscribed: (threadId: string) => Promise<boolean>;
  readonly acquireLock: (input: { readonly threadId: string; readonly ttlMs: number }) => Promise<{
    readonly threadId: string;
    readonly token: string;
    readonly expiresAt: number;
  } | null>;
  readonly releaseLock: (lock: {
    readonly threadId: string;
    readonly token: string;
  }) => Promise<void>;
  readonly forceReleaseLock: (threadId: string) => Promise<void>;
  readonly extendLock: (input: {
    readonly lock: { readonly threadId: string; readonly token: string };
    readonly ttlMs: number;
  }) => Promise<boolean>;
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly ttlMs?: number;
  }) => Promise<void>;
  readonly setIfNotExists: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly ttlMs?: number;
  }) => Promise<boolean>;
  readonly delete: (key: string) => Promise<void>;
  readonly appendToList: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly maxLength?: number;
    readonly ttlMs?: number;
  }) => Promise<void>;
  readonly getList: (key: string) => Promise<string[]>;
  readonly enqueue: (input: {
    readonly threadId: string;
    readonly entryJson: string;
    readonly maxSize: number;
  }) => Promise<number>;
  readonly dequeue: (threadId: string) => Promise<string | null>;
  readonly queueDepth: (threadId: string) => Promise<number>;
}

function nowMs() {
  return Date.now();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nullable<T>(value: T | null | undefined) {
  return value === undefined ? null : value;
}

function projectWorkspaceRoot(row: Pick<ProjectRow, "workspaceRoot" | "repoName">) {
  return row.workspaceRoot ?? `C:\\Users\\Vivek\\Affil\\${row.repoName}`;
}

function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.id,
    repoName: row.repoName,
    workspaceRoot: projectWorkspaceRoot(row),
    defaultBranch: row.defaultBranch,
    githubOwner: row.githubOwner,
    githubRepo: row.githubRepo,
    ...(row.t3ProjectId !== null ? { t3ProjectId: row.t3ProjectId } : {}),
  };
}

function taskIntakeEventPayload(input: {
  readonly message: TaskIntakeMessage;
  readonly externalLink: { readonly kind: string; readonly externalId: string };
}) {
  const { message, externalLink } = input;
  return {
    source: message.source,
    externalLinkKind: externalLink.kind,
    externalId: externalLink.externalId,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    textPreview: message.text.length > 240 ? `${message.text.slice(0, 237)}...` : message.text,
    ...(message.url !== undefined ? { url: message.url } : {}),
    ...(message.conversation.teamId !== undefined ? { teamId: message.conversation.teamId } : {}),
    ...(message.conversation.channelId !== undefined
      ? { channelId: message.conversation.channelId }
      : {}),
    ...(message.actor?.displayName !== undefined
      ? { actorDisplayName: message.actor.displayName }
      : {}),
  };
}

function parseJsonArray(valueJson: string | null): string[] {
  if (valueJson === null) return [];
  const parsed = JSON.parse(valueJson);
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string")
    : [];
}

function rowOrNull<TRow>(row: unknown): TRow | null {
  return row === undefined ? null : (row as TRow);
}

function rows<TRow>(result: unknown): TRow[] {
  return result as TRow[];
}

export class LocalOrchestratorStore {
  readonly #db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#db.exec(SCHEMA_SQL);
  }

  close() {
    this.#db.close();
  }

  upsertProject(input: UpsertProjectInput): ProjectRecord {
    const now = nowMs();
    const existing = rowOrNull<ProjectRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          repo_name AS repoName,
          workspace_root AS workspaceRoot,
          default_branch AS defaultBranch,
          github_owner AS githubOwner,
          github_repo AS githubRepo,
          t3_project_id AS t3ProjectId
        FROM projects
        WHERE github_owner = ? AND github_repo = ?
      `,
        )
        .get(input.githubOwner, input.githubRepo),
    );

    const id = existing?.id ?? newId("project");
    this.#db
      .prepare(
        `
        INSERT INTO projects (
          id,
          repo_name,
          workspace_root,
          default_branch,
          github_owner,
          github_repo,
          linear_team_id,
          linear_project_id,
          t3_project_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_owner, github_repo) DO UPDATE SET
          repo_name = excluded.repo_name,
          workspace_root = excluded.workspace_root,
          default_branch = excluded.default_branch,
          linear_team_id = excluded.linear_team_id,
          linear_project_id = excluded.linear_project_id,
          t3_project_id = excluded.t3_project_id,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        input.repoName,
        nullable(input.workspaceRoot),
        input.defaultBranch,
        input.githubOwner,
        input.githubRepo,
        nullable(input.linearTeamId),
        nullable(input.linearProjectId),
        nullable(input.t3ProjectId),
        existing?.id === undefined ? now : now,
        now,
      );

    const row = rowOrNull<ProjectRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          repo_name AS repoName,
          workspace_root AS workspaceRoot,
          default_branch AS defaultBranch,
          github_owner AS githubOwner,
          github_repo AS githubRepo,
          t3_project_id AS t3ProjectId
        FROM projects
        WHERE id = ?
      `,
        )
        .get(id),
    );
    if (row === null) throw new Error(`Project ${id} was not persisted`);
    return toProjectRecord(row);
  }

  listProjects(): ProjectRecord[] {
    const projectRows = rows<ProjectRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          repo_name AS repoName,
          workspace_root AS workspaceRoot,
          default_branch AS defaultBranch,
          github_owner AS githubOwner,
          github_repo AS githubRepo,
          t3_project_id AS t3ProjectId
        FROM projects
        ORDER BY repo_name ASC
      `,
        )
        .all(),
    );
    return projectRows.map(toProjectRecord);
  }

  resolveTaskIntakeMessage(input: {
    readonly message: TaskIntakeMessage;
    readonly externalLink: {
      readonly kind: string;
      readonly externalId: string;
    };
    readonly title: string;
  }): TaskIntakeStoredEvent {
    return this.transaction(() => {
      const existingEvent = this.findTaskEventByKey(input.message.eventId);
      if (existingEvent !== null) {
        if (
          existingEvent.kind === "task-intake.follow-up" &&
          this.findTaskEventByKey(`${input.message.eventId}:runtime-continuation`) === null
        ) {
          return this.routedExistingTask(existingEvent.taskId);
        }
        return {
          status: "duplicate" as const,
          taskId: existingEvent.taskId,
        };
      }

      const existingLink = this.findExternalLink(
        input.externalLink.kind,
        input.externalLink.externalId,
      );
      if (existingLink !== null) {
        const now = nowMs();
        this.insertTaskEvent({
          taskId: existingLink.taskId,
          eventKey: input.message.eventId,
          kind: "task-intake.follow-up",
          summary: `Follow-up received from ${input.message.source}.`,
          payload: taskIntakeEventPayload(input),
          createdAt: now,
        });
        this.patchTaskUpdatedAt(existingLink.taskId, now);
        return this.routedExistingTask(existingLink.taskId);
      }

      const projects = this.listProjects();
      const project = resolveMentionedProject(input.message.text, projects);
      if (project === null) {
        return {
          status: "needs_project" as const,
          projects,
        };
      }

      const now = nowMs();
      const taskId = newId("task");
      this.#db
        .prepare(
          `
          INSERT INTO tasks (
            id,
            project_id,
            title,
            status,
            created_from,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'ready', ?, ?, ?)
        `,
        )
        .run(
          taskId,
          project.projectId,
          input.title || `${input.message.source} task`,
          input.message.source,
          now,
          now,
        );
      this.#db
        .prepare(
          `
          INSERT INTO task_external_links (
            id,
            task_id,
            kind,
            external_id,
            url,
            muted,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        `,
        )
        .run(
          newId("link"),
          taskId,
          input.externalLink.kind,
          input.externalLink.externalId,
          nullable(input.message.url),
          now,
          now,
        );
      this.insertTaskEvent({
        taskId,
        eventKey: input.message.eventId,
        kind: "task-intake.created",
        summary: `Task created from ${input.message.source}.`,
        payload: taskIntakeEventPayload(input),
        createdAt: now,
      });
      return {
        status: "created" as const,
        taskId,
        projectId: project.projectId,
      };
    });
  }

  recordStartFailed(input: {
    readonly message: TaskIntakeMessage;
    readonly taskId: string;
    readonly summary: string;
  }) {
    const now = nowMs();
    this.#db
      .prepare(
        `
        UPDATE tasks
        SET status = 'failed',
            status_reason = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.summary, now, input.taskId);
    this.insertTaskEvent({
      taskId: input.taskId,
      eventKey: `${input.message.eventId}:start-failed`,
      kind: "task-intake.start-failed",
      summary: `Task Intake failed to start runtime for ${input.message.source}.`,
      payload: {
        source: input.message.source,
        summary: input.summary,
      },
      createdAt: now,
    });
  }

  getTaskRuntimeSeed(taskId: string) {
    const row = rowOrNull<{
      readonly taskId: string;
      readonly title: string;
      readonly status: TaskStatus;
      readonly projectId: string;
      readonly repoName: string;
      readonly workspaceRoot: string | null;
      readonly defaultBranch: string;
    }>(
      this.#db
        .prepare(
          `
        SELECT
          tasks.id AS taskId,
          tasks.title AS title,
          tasks.status AS status,
          projects.id AS projectId,
          projects.repo_name AS repoName,
          projects.workspace_root AS workspaceRoot,
          projects.default_branch AS defaultBranch
        FROM tasks
        JOIN projects ON projects.id = tasks.project_id
        WHERE tasks.id = ?
      `,
        )
        .get(taskId),
    );
    if (row === null) return null;
    return {
      task: {
        id: row.taskId,
        title: row.title,
        status: row.status,
      },
      project: {
        id: row.projectId,
        repoName: row.repoName,
        workspaceRoot: projectWorkspaceRoot({
          repoName: row.repoName,
          workspaceRoot: row.workspaceRoot,
        }),
        defaultBranch: row.defaultBranch,
      },
    };
  }

  prepareWorkSessionSeed(input: { readonly taskId: string; readonly startCodingAgent: boolean }) {
    return this.transaction(() => {
      const task = this.getTask(input.taskId);
      if (task === null) throw new Error(`Task ${input.taskId} does not exist`);

      const now = nowMs();
      const taskThreadId = newId("thread");
      const workSessionId = newId("work_session");
      this.#db
        .prepare(
          `
          INSERT INTO task_threads (
            id,
            task_id,
            t3_thread_id,
            role,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'primary', ?, ?)
        `,
        )
        .run(taskThreadId, input.taskId, `pending:${crypto.randomUUID()}`, now, now);
      this.#db
        .prepare(
          `
          INSERT INTO work_sessions (
            id,
            task_id,
            task_thread_id,
            t3_thread_id,
            status,
            bridge_run_id,
            runtime_status,
            runtime_updated_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'requested', ?, 'requested', ?, ?)
        `,
        )
        .run(
          workSessionId,
          input.taskId,
          taskThreadId,
          `pending:${taskThreadId}`,
          taskThreadId,
          now,
          now,
        );
      this.#db
        .prepare(
          `
          UPDATE tasks
          SET current_primary_task_thread_id = ?,
              status = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          taskThreadId,
          task.status === "ready"
            ? input.startCodingAgent
              ? "working"
              : "needs_input"
            : task.status,
          now,
          input.taskId,
        );
      this.insertTaskEvent({
        taskId: input.taskId,
        kind: "runtime.materialization-requested",
        summary: "T3 runtime materialization was requested.",
        payload: { taskThreadId, workSessionId },
        createdAt: now,
      });
      return { taskThreadId, workSessionId };
    });
  }

  recordTaskRuntimeMaterialized(input: {
    readonly taskId: string;
    readonly taskThreadId: string;
    readonly workSessionId: string;
    readonly t3ProjectId: string;
    readonly t3ThreadId: string;
    readonly eventKey: string;
    readonly branch?: string;
    readonly worktreePath?: string;
    readonly environmentId?: string;
    readonly runtimeEndpointUrl?: string;
    readonly acceptedAt: number;
  }) {
    this.transaction(() => {
      this.#db
        .prepare(
          `
          UPDATE task_threads
          SET t3_project_id = ?,
              t3_thread_id = ?,
              branch = COALESCE(?, branch),
              worktree_path = COALESCE(?, worktree_path),
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          input.t3ProjectId,
          input.t3ThreadId,
          nullable(input.branch),
          nullable(input.worktreePath),
          input.acceptedAt,
          input.taskThreadId,
        );
      this.#db
        .prepare(
          `
          UPDATE work_sessions
          SET t3_thread_id = ?,
              status = 'accepted',
              environment_id = COALESCE(?, environment_id),
              runtime_endpoint_url = COALESCE(?, runtime_endpoint_url),
              runtime_updated_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          input.t3ThreadId,
          nullable(input.environmentId),
          nullable(input.runtimeEndpointUrl),
          input.acceptedAt,
          input.acceptedAt,
          input.workSessionId,
        );
      this.#db
        .prepare(
          `
          UPDATE tasks
          SET current_primary_task_thread_id = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(input.taskThreadId, input.acceptedAt, input.taskId);
      this.insertTaskEvent({
        taskId: input.taskId,
        eventKey: input.eventKey,
        kind: "runtime.materialized",
        summary: "T3 runtime was materialized for the Task.",
        payload: input,
        createdAt: input.acceptedAt,
      });
    });
  }

  recordTaskRuntimeMaterializationFailed(input: {
    readonly taskId: string;
    readonly workSessionId: string;
    readonly eventKey: string;
    readonly failureSummary: string;
    readonly failedAt: number;
  }) {
    this.#db
      .prepare(
        `
        UPDATE work_sessions
        SET status = 'failed',
            failure_summary = ?,
            runtime_status = 'failed',
            runtime_failure_summary = ?,
            runtime_updated_at = ?,
            ended_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        input.failureSummary,
        input.failureSummary,
        input.failedAt,
        input.failedAt,
        input.failedAt,
        input.workSessionId,
      );
    this.#db
      .prepare(
        `
        UPDATE tasks
        SET status = 'failed',
            status_reason = ?,
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.failureSummary, input.failedAt, input.taskId);
    this.insertTaskEvent({
      taskId: input.taskId,
      eventKey: input.eventKey,
      kind: "runtime.materialization-failed",
      summary: "T3 runtime materialization failed.",
      payload: {
        workSessionId: input.workSessionId,
        failureSummary: input.failureSummary,
      },
      createdAt: input.failedAt,
    });
  }

  claimTaskRuntimeContinuation(input: {
    readonly taskId: string;
    readonly workSessionId: string;
    readonly t3ThreadId: string;
    readonly eventKey: string;
    readonly claimedAt: number;
  }) {
    const existing = this.findTaskEventByKey(input.eventKey);
    if (existing !== null) {
      return {
        claimed: false,
        claimedAt: existing.createdAt,
      };
    }
    this.insertTaskEvent({
      taskId: input.taskId,
      eventKey: input.eventKey,
      kind: "runtime.continuation-claimed",
      summary: "Claimed T3 runtime continuation for the Task.",
      payload: {
        workSessionId: input.workSessionId,
        t3ThreadId: input.t3ThreadId,
      },
      createdAt: input.claimedAt,
    });
    return {
      claimed: true,
      claimedAt: input.claimedAt,
    };
  }

  getTaskRuntimeContinuationRoute(input: {
    readonly taskId: string;
    readonly workSessionId: string;
    readonly t3ThreadId: string;
  }) {
    const workSession = this.getWorkSession(input.workSessionId);
    if (workSession === null) {
      throw new Error(`Work Session ${input.workSessionId} does not exist`);
    }
    if (workSession.taskId !== input.taskId) {
      throw new Error(
        `Work Session ${input.workSessionId} does not belong to Task ${input.taskId}`,
      );
    }
    if (workSession.t3ThreadId !== input.t3ThreadId) {
      throw new Error(
        `Work Session ${input.workSessionId} is attached to T3 Thread ${workSession.t3ThreadId}, not ${input.t3ThreadId}`,
      );
    }
    return {};
  }

  recordTaskRuntimeContinuationAccepted(input: {
    readonly taskId: string;
    readonly workSessionId: string;
    readonly t3ThreadId: string;
    readonly eventKey: string;
    readonly acceptedAt: number;
  }) {
    if (this.findTaskEventByKey(input.eventKey) !== null) return;
    this.#db
      .prepare(
        `
        UPDATE work_sessions
        SET t3_thread_id = ?,
            status = 'accepted',
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.t3ThreadId, input.acceptedAt, input.workSessionId);
    this.#db
      .prepare(
        `
        UPDATE tasks
        SET status = 'working',
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.acceptedAt, input.taskId);
    this.insertTaskEvent({
      taskId: input.taskId,
      eventKey: input.eventKey,
      kind: "runtime.continuation-accepted",
      summary: "T3 runtime continuation was accepted for the Task.",
      payload: {
        workSessionId: input.workSessionId,
        t3ThreadId: input.t3ThreadId,
      },
      createdAt: input.acceptedAt,
    });
  }

  applyTaskRuntimeLifecycleEvent(input: {
    readonly eventId: string;
    readonly taskId: string;
    readonly workSessionId: string;
    readonly type: "started" | "completed" | "failed" | "interrupted";
    readonly occurredAt: string;
    readonly t3ThreadId?: string;
    readonly t3TurnId?: string;
    readonly failureSummary?: string;
    readonly assistantResponse?: string;
  }) {
    const existing = this.findTaskEventByKey(input.eventId);
    const workSession = this.getWorkSession(input.workSessionId);
    if (workSession === null) throw new Error(`Work Session ${input.workSessionId} does not exist`);
    if (workSession.taskId !== input.taskId) {
      throw new Error(
        `Work Session ${input.workSessionId} does not belong to Task ${input.taskId}`,
      );
    }
    if (existing !== null) {
      return { applied: false, status: workSession.status };
    }

    const occurredAtMs = Date.parse(input.occurredAt);
    const ended =
      input.type === "completed" || input.type === "failed" || input.type === "interrupted";
    this.#db
      .prepare(
        `
        UPDATE work_sessions
        SET status = ?,
            started_at = CASE WHEN ? = 'started' AND started_at IS NULL THEN ? ELSE started_at END,
            ended_at = CASE WHEN ? THEN ? ELSE ended_at END,
            t3_thread_id = COALESCE(?, t3_thread_id),
            t3_turn_id = COALESCE(?, t3_turn_id),
            failure_summary = COALESCE(?, failure_summary),
            assistant_response = COALESCE(?, assistant_response),
            updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        input.type,
        input.type,
        occurredAtMs,
        ended ? 1 : 0,
        occurredAtMs,
        nullable(input.t3ThreadId),
        nullable(input.t3TurnId),
        nullable(input.failureSummary),
        nullable(input.assistantResponse),
        occurredAtMs,
        input.workSessionId,
      );
    if (input.type === "failed") {
      this.#db
        .prepare(
          `
          UPDATE tasks
          SET status = 'failed',
              status_reason = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(input.failureSummary ?? "Coding Agent work failed.", occurredAtMs, input.taskId);
    }
    this.insertTaskEvent({
      taskId: input.taskId,
      eventKey: input.eventId,
      kind: `work-session.${input.type}`,
      summary: `Work Session ${input.type}.`,
      payload: {
        workSessionId: input.workSessionId,
        ...(input.t3ThreadId !== undefined ? { t3ThreadId: input.t3ThreadId } : {}),
        ...(input.t3TurnId !== undefined ? { t3TurnId: input.t3TurnId } : {}),
        ...(input.failureSummary !== undefined ? { failureSummary: input.failureSummary } : {}),
        ...(input.assistantResponse !== undefined
          ? { assistantResponse: input.assistantResponse }
          : {}),
      },
      createdAt: occurredAtMs,
    });
    return { applied: true, status: input.type };
  }

  recordTaskPullRequestsFromAssistantMessage(input: {
    readonly taskId: string;
    readonly sourceEventId: string;
    readonly assistantMessage: string;
    readonly observedAt: number;
  }) {
    let recorded = 0;
    for (const pullRequest of extractGitHubPullRequests(input.assistantMessage)) {
      const externalId = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;
      const existing = rowOrNull<{ readonly id: string }>(
        this.#db
          .prepare("SELECT id FROM github_pull_requests WHERE external_id = ?")
          .get(externalId),
      );
      if (existing === null) {
        this.#db
          .prepare(
            `
            INSERT INTO github_pull_requests (
              id,
              task_id,
              external_id,
              owner,
              repo,
              number,
              url,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            newId("github_pr"),
            input.taskId,
            externalId,
            pullRequest.owner,
            pullRequest.repo,
            pullRequest.number,
            pullRequest.url,
            input.observedAt,
            input.observedAt,
          );
      }
      this.insertTaskEvent({
        taskId: input.taskId,
        eventKey: `${input.sourceEventId}:github-pr:${externalId}`,
        kind: "github.pull-request.observed",
        summary: "Observed GitHub pull request in assistant message.",
        payload: {
          externalId,
          url: pullRequest.url,
        },
        createdAt: input.observedAt,
      });
      recorded += 1;
    }
    return { recorded };
  }

  appendOrchestratorEvent(input: {
    readonly kind: string;
    readonly source: string;
    readonly severity?: "debug" | "info" | "warn" | "error";
    readonly summary: string;
    readonly eventKey?: string;
    readonly taskId?: string;
    readonly workSessionId?: string;
    readonly externalId?: string;
    readonly payload?: unknown;
  }) {
    this.#db
      .prepare(
        `
        INSERT OR IGNORE INTO orchestrator_events (
          id,
          event_key,
          kind,
          source,
          severity,
          summary,
          task_id,
          work_session_id,
          external_id,
          payload_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        newId("orchestrator_event"),
        nullable(input.eventKey),
        input.kind,
        input.source,
        input.severity ?? "info",
        input.summary,
        nullable(input.taskId),
        nullable(input.workSessionId),
        nullable(input.externalId),
        input.payload === undefined ? null : JSON.stringify(input.payload),
        nowMs(),
      );
  }

  findPrimarySlackLink(taskId: string) {
    return rowOrNull<ExternalLinkRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          task_id AS taskId,
          kind,
          external_id AS externalId,
          url,
          muted
        FROM task_external_links
        WHERE task_id = ? AND kind = 'slack_thread'
        ORDER BY created_at ASC
        LIMIT 1
      `,
        )
        .get(taskId),
    );
  }

  claimTaskReply(
    eventKey: string,
    taskId: string,
    kind: string,
    summary: string,
    payload: unknown,
  ) {
    if (this.findTaskEventByKey(eventKey) !== null) return false;
    this.insertTaskEvent({
      taskId,
      eventKey,
      kind,
      summary,
      payload,
      createdAt: nowMs(),
    });
    return true;
  }

  getTask(taskId: string): TaskRow | null {
    return rowOrNull<TaskRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          project_id AS projectId,
          title,
          status,
          status_reason AS statusReason,
          current_primary_task_thread_id AS currentPrimaryTaskThreadId
        FROM tasks
        WHERE id = ?
      `,
        )
        .get(taskId),
    );
  }

  getChatSdkStateOps(): LocalChatSdkStateOps {
    return {
      subscribe: async (threadId) => {
        const now = nowMs();
        this.#db
          .prepare(
            `
            INSERT INTO chat_sdk_subscriptions (thread_id, created_at, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET updated_at = excluded.updated_at
          `,
          )
          .run(threadId, now, now);
      },
      unsubscribe: async (threadId) => {
        this.#db.prepare("DELETE FROM chat_sdk_subscriptions WHERE thread_id = ?").run(threadId);
      },
      isSubscribed: async (threadId) => {
        const row = this.#db
          .prepare("SELECT thread_id FROM chat_sdk_subscriptions WHERE thread_id = ?")
          .get(threadId);
        return row !== undefined;
      },
      acquireLock: async ({ threadId, ttlMs }) => {
        const now = nowMs();
        const existing = rowOrNull<{ readonly token: string; readonly expiresAt: number }>(
          this.#db
            .prepare(
              "SELECT token, expires_at AS expiresAt FROM chat_sdk_locks WHERE thread_id = ?",
            )
            .get(threadId),
        );
        if (existing !== null && existing.expiresAt > now) return null;

        const token = crypto.randomUUID();
        const expiresAt = now + ttlMs;
        this.#db
          .prepare(
            `
            INSERT INTO chat_sdk_locks (thread_id, token, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
              token = excluded.token,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
          )
          .run(threadId, token, expiresAt, now, now);
        return { threadId, token, expiresAt };
      },
      releaseLock: async (lock) => {
        this.#db
          .prepare("DELETE FROM chat_sdk_locks WHERE thread_id = ? AND token = ?")
          .run(lock.threadId, lock.token);
      },
      forceReleaseLock: async (threadId) => {
        this.#db.prepare("DELETE FROM chat_sdk_locks WHERE thread_id = ?").run(threadId);
      },
      extendLock: async ({ lock, ttlMs }) => {
        const result = this.#db
          .prepare(
            `
            UPDATE chat_sdk_locks
            SET expires_at = ?,
                updated_at = ?
            WHERE thread_id = ? AND token = ?
          `,
          )
          .run(nowMs() + ttlMs, nowMs(), lock.threadId, lock.token);
        return result.changes > 0;
      },
      get: async (key) => {
        const now = nowMs();
        const row = rowOrNull<{ readonly valueJson: string }>(
          this.#db
            .prepare(
              `
            SELECT value_json AS valueJson
            FROM chat_sdk_cache
            WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
          `,
            )
            .get(key, now),
        );
        return row?.valueJson ?? null;
      },
      set: async ({ key, valueJson, ttlMs }) => {
        const now = nowMs();
        this.#db
          .prepare(
            `
            INSERT INTO chat_sdk_cache (key, value_json, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
          )
          .run(key, valueJson, ttlMs === undefined ? null : now + ttlMs, now, now);
      },
      setIfNotExists: async ({ key, valueJson, ttlMs }) => {
        if ((await this.getChatSdkStateOps().get(key)) !== null) return false;
        await this.getChatSdkStateOps().set({
          key,
          valueJson,
          ...(ttlMs !== undefined ? { ttlMs } : {}),
        });
        return true;
      },
      delete: async (key) => {
        this.#db.prepare("DELETE FROM chat_sdk_cache WHERE key = ?").run(key);
      },
      appendToList: async ({ key, valueJson, maxLength, ttlMs }) => {
        const now = nowMs();
        const existing = rowOrNull<{ readonly valuesJson: string }>(
          this.#db
            .prepare("SELECT values_json AS valuesJson FROM chat_sdk_lists WHERE key = ?")
            .get(key),
        );
        const values = [...parseJsonArray(existing?.valuesJson ?? null), valueJson];
        const trimmed = maxLength === undefined ? values : values.slice(-maxLength);
        this.#db
          .prepare(
            `
            INSERT INTO chat_sdk_lists (key, values_json, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              values_json = excluded.values_json,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
          )
          .run(key, JSON.stringify(trimmed), ttlMs === undefined ? null : now + ttlMs, now, now);
      },
      getList: async (key) => {
        const now = nowMs();
        const row = rowOrNull<{ readonly valuesJson: string }>(
          this.#db
            .prepare(
              `
            SELECT values_json AS valuesJson
            FROM chat_sdk_lists
            WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
          `,
            )
            .get(key, now),
        );
        return parseJsonArray(row?.valuesJson ?? null);
      },
      enqueue: async ({ threadId, entryJson, maxSize }) => {
        const now = nowMs();
        const existing = rowOrNull<{ readonly entriesJson: string }>(
          this.#db
            .prepare("SELECT entries_json AS entriesJson FROM chat_sdk_queues WHERE thread_id = ?")
            .get(threadId),
        );
        const entries = [...parseJsonArray(existing?.entriesJson ?? null), entryJson].slice(
          -maxSize,
        );
        this.#db
          .prepare(
            `
            INSERT INTO chat_sdk_queues (thread_id, entries_json, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
              entries_json = excluded.entries_json,
              updated_at = excluded.updated_at
          `,
          )
          .run(threadId, JSON.stringify(entries), now, now);
        return entries.length;
      },
      dequeue: async (threadId) => {
        const existing = rowOrNull<{ readonly entriesJson: string }>(
          this.#db
            .prepare("SELECT entries_json AS entriesJson FROM chat_sdk_queues WHERE thread_id = ?")
            .get(threadId),
        );
        const entries = parseJsonArray(existing?.entriesJson ?? null);
        const [next, ...rest] = entries;
        if (next === undefined) return null;
        this.#db
          .prepare(
            "UPDATE chat_sdk_queues SET entries_json = ?, updated_at = ? WHERE thread_id = ?",
          )
          .run(JSON.stringify(rest), nowMs(), threadId);
        return next;
      },
      queueDepth: async (threadId) => {
        const existing = rowOrNull<{ readonly entriesJson: string }>(
          this.#db
            .prepare("SELECT entries_json AS entriesJson FROM chat_sdk_queues WHERE thread_id = ?")
            .get(threadId),
        );
        return parseJsonArray(existing?.entriesJson ?? null).length;
      },
    };
  }

  private findTaskEventByKey(eventKey: string) {
    return rowOrNull<{
      readonly taskId: string;
      readonly kind: string;
      readonly createdAt: number;
    }>(
      this.#db
        .prepare(
          `
        SELECT
          task_id AS taskId,
          kind,
          created_at AS createdAt
        FROM task_events
        WHERE event_key = ?
      `,
        )
        .get(eventKey),
    );
  }

  private findExternalLink(kind: string, externalId: string): ExternalLinkRow | null {
    return rowOrNull<ExternalLinkRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          task_id AS taskId,
          kind,
          external_id AS externalId,
          url,
          muted
        FROM task_external_links
        WHERE kind = ? AND external_id = ?
      `,
        )
        .get(kind, externalId),
    );
  }

  private routedExistingTask(taskId: string): TaskIntakeStoredEvent {
    const existing = this.findExistingTaskRuntime(taskId);
    return {
      status: "routed_existing",
      taskId,
      ...(existing.projectId !== undefined ? { projectId: existing.projectId } : {}),
      ...(existing.t3ThreadId !== undefined ? { t3ThreadId: existing.t3ThreadId } : {}),
      ...(existing.workSessionId !== undefined ? { workSessionId: existing.workSessionId } : {}),
    };
  }

  private findExistingTaskRuntime(taskId: string): TaskIntakeExistingTask {
    const task = this.getTask(taskId);
    if (task === null) throw new Error(`Linked Task ${taskId} does not exist`);
    if (task.currentPrimaryTaskThreadId === null) {
      return { taskId, projectId: task.projectId };
    }
    const primaryThread = rowOrNull<TaskThreadRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          t3_thread_id AS t3ThreadId,
          worktree_path AS worktreePath
        FROM task_threads
        WHERE id = ?
      `,
        )
        .get(task.currentPrimaryTaskThreadId),
    );
    const currentWorkSession = rowOrNull<WorkSessionRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          task_id AS taskId,
          task_thread_id AS taskThreadId,
          t3_thread_id AS t3ThreadId,
          status
        FROM work_sessions
        WHERE task_id = ? AND task_thread_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
        )
        .get(taskId, task.currentPrimaryTaskThreadId),
    );
    return {
      taskId,
      projectId: task.projectId,
      ...(primaryThread !== null && !primaryThread.t3ThreadId.startsWith("pending:")
        ? { t3ThreadId: primaryThread.t3ThreadId }
        : {}),
      ...(currentWorkSession !== null ? { workSessionId: currentWorkSession.id } : {}),
    };
  }

  private getWorkSession(workSessionId: string): WorkSessionRow | null {
    return rowOrNull<WorkSessionRow>(
      this.#db
        .prepare(
          `
        SELECT
          id,
          task_id AS taskId,
          task_thread_id AS taskThreadId,
          t3_thread_id AS t3ThreadId,
          status
        FROM work_sessions
        WHERE id = ?
      `,
        )
        .get(workSessionId),
    );
  }

  private patchTaskUpdatedAt(taskId: string, updatedAt: number) {
    this.#db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(updatedAt, taskId);
  }

  private transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.#db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK;");
      throw error;
    }
  }

  private insertTaskEvent(input: {
    readonly taskId: string;
    readonly kind: string;
    readonly summary: string;
    readonly createdAt: number;
    readonly eventKey?: string;
    readonly payload?: unknown;
  }) {
    this.#db
      .prepare(
        `
        INSERT OR IGNORE INTO task_events (
          id,
          task_id,
          event_key,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        newId("task_event"),
        input.taskId,
        nullable(input.eventKey),
        input.kind,
        input.summary,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.createdAt,
      );
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  repo_name TEXT NOT NULL,
  workspace_root TEXT,
  default_branch TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  linear_team_id TEXT,
  linear_project_id TEXT,
  t3_project_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(github_owner, github_repo)
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_root ON projects(workspace_root);
CREATE INDEX IF NOT EXISTS idx_projects_linear ON projects(linear_team_id, linear_project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  current_primary_task_thread_id TEXT,
  archived_at INTEGER,
  created_from TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status_updated ON tasks(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks(project_id, updated_at);

CREATE TABLE IF NOT EXISTS task_threads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  t3_thread_id TEXT NOT NULL,
  t3_project_id TEXT,
  branch TEXT,
  worktree_path TEXT,
  role TEXT NOT NULL,
  coding_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_threads_task ON task_threads(task_id);
CREATE INDEX IF NOT EXISTS idx_task_threads_t3_thread ON task_threads(t3_thread_id);

CREATE TABLE IF NOT EXISTS task_external_links (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  sync_cursor TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kind, external_id)
);

CREATE INDEX IF NOT EXISTS idx_task_external_links_task ON task_external_links(task_id);

CREATE TABLE IF NOT EXISTS github_pull_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  head_sha TEXT,
  head_branch TEXT,
  title TEXT,
  state TEXT,
  merged_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_pull_requests_repo_sha ON github_pull_requests(owner, repo, head_sha);

CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_thread_id TEXT NOT NULL REFERENCES task_threads(id) ON DELETE CASCADE,
  t3_thread_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  updated_at INTEGER NOT NULL,
  t3_turn_id TEXT,
  failure_summary TEXT,
  assistant_response TEXT,
  bridge_run_id TEXT,
  runtime_id TEXT,
  runtime_provider_kind TEXT,
  runtime_external_id TEXT,
  runtime_status TEXT,
  environment_id TEXT,
  runtime_endpoint_url TEXT,
  runtime_provider_ref_json TEXT,
  runtime_services_json TEXT,
  runtime_failure_summary TEXT,
  runtime_updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_task_updated ON work_sessions(task_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_sessions_t3_thread ON work_sessions(t3_thread_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_bridge_run ON work_sessions(bridge_run_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_runtime_id ON work_sessions(runtime_id);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_key TEXT UNIQUE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);

CREATE TABLE IF NOT EXISTS orchestrator_events (
  id TEXT PRIMARY KEY,
  event_key TEXT UNIQUE,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  task_id TEXT,
  work_session_id TEXT,
  external_id TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_created ON orchestrator_events(created_at);
CREATE INDEX IF NOT EXISTS idx_orchestrator_events_kind_created ON orchestrator_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_orchestrator_events_task_created ON orchestrator_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orchestrator_events_external_created ON orchestrator_events(external_id, created_at);

CREATE TABLE IF NOT EXISTS chat_sdk_subscriptions (
  thread_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sdk_locks (
  thread_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sdk_cache (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sdk_lists (
  key TEXT PRIMARY KEY,
  values_json TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sdk_queues (
  thread_id TEXT PRIMARY KEY,
  entries_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export interface RuntimeMaterializeInput {
  readonly taskId: string;
  readonly initialPrompt: string;
  readonly attachments?: ReadonlyArray<UploadChatAttachment>;
  readonly startCodingAgent: boolean;
  readonly modelSelection?: ModelSelection;
}
