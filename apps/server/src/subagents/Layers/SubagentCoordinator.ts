import {
  CommandId,
  MessageId,
  ThreadId,
  type GitStatusResult,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type SubagentReport,
  type SubagentRun,
  type SubagentSkill,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Option, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  RuntimeReceiptBus,
  type TurnProcessingQuiescedReceipt,
} from "../../orchestration/Services/RuntimeReceiptBus.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { SkillCatalog } from "../Services/SkillCatalog.ts";
import {
  SubagentCoordinator,
  type SubagentCoordinatorShape,
} from "../Services/SubagentCoordinator.ts";

type SubagentDomainEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.subagent-start-requested"
      | "thread.subagent-report-accepted"
      | "thread.subagent-cleanup-requested";
  }
>;

type SubagentCoordinatorInput =
  | {
      readonly kind: "event";
      readonly event: SubagentDomainEvent;
    }
  | {
      readonly kind: "receipt";
      readonly receipt: TurnProcessingQuiescedReceipt;
    };

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:subagent:${tag}:${crypto.randomUUID()}`);

function sanitizeBranchFragment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 48);
}

function buildSubagentBranchName(skillId: string, runId: string): string {
  const skillFragment = sanitizeBranchFragment(skillId) || "skill";
  const runFragment = sanitizeBranchFragment(runId).slice(-8) || crypto.randomUUID().slice(0, 8);
  return `t3code/subagent-${skillFragment}-${runFragment}`;
}

function buildSubagentThreadTitle(skill: SubagentSkill, task: string): string {
  const suffix = task.trim().slice(0, 64);
  return suffix.length > 0 ? `${skill.title}: ${suffix}` : skill.title;
}

function buildSubagentDeveloperInstructions(skill: SubagentSkill): string {
  return [
    "You are a specialist sub-agent running in an isolated git worktree.",
    "Work only inside this worktree.",
    "When you finish, your final assistant message must use this exact markdown structure:",
    "## Summary",
    "## Findings",
    "- ...",
    "## Actions Taken",
    "- ...",
    "## Recommended Actions",
    "- ...",
    "If a section has nothing to report, write `None.` under it.",
    "",
    `# Skill: ${skill.title}`,
    "",
    skill.promptMarkdown,
  ].join("\n");
}

function extractSection(markdown: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, "im");
  const match = pattern.exec(markdown);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function extractBulletLines(markdown: string | null): string[] {
  if (!markdown) {
    return [];
  }
  const bullets = markdown
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== "none.");
  return bullets;
}

function extractSummary(markdown: string): string | null {
  const explicit = extractSection(markdown, "Summary");
  if (explicit) {
    const singleLine = explicit
      .split(/\r?\n/g)
      .find((line) => line.trim().length > 0)
      ?.trim();
    if (singleLine && singleLine.toLowerCase() !== "none.") {
      return singleLine;
    }
  }
  const firstParagraph = markdown
    .split(/\r?\n\r?\n/g)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
  return firstParagraph ?? null;
}

function synthesizeReport(
  markdown: string,
  filesChanged: ReadonlyArray<string>,
): SubagentReport | null {
  const normalizedMarkdown = markdown.trim();
  const summary = extractSummary(normalizedMarkdown);
  if (!summary) {
    return null;
  }
  return {
    summary,
    markdown: normalizedMarkdown,
    findings: extractBulletLines(extractSection(normalizedMarkdown, "Findings")),
    actionsTaken: extractBulletLines(extractSection(normalizedMarkdown, "Actions Taken")),
    recommendedActions: extractBulletLines(
      extractSection(normalizedMarkdown, "Recommended Actions"),
    ),
    filesChanged: [...filesChanged],
    generatedAt: new Date().toISOString(),
  };
}

function findProjectRoot(
  readModel: OrchestrationReadModel,
  thread: OrchestrationThread,
): string | null {
  return (
    readModel.projects.find((project) => project.id === thread.projectId)?.workspaceRoot ?? null
  );
}

function findRun(thread: OrchestrationThread, runId: string): SubagentRun | null {
  return thread.subagentRuns?.find((run) => run.id === runId) ?? null;
}

const EMPTY_GIT_STATUS: GitStatusResult = {
  branch: null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

const makeSubagentCoordinator = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const git = yield* GitCore;
  const providerService = yield* ProviderService;
  const skillCatalog = yield* SkillCatalog;
  const runtimeReceiptBus = yield* RuntimeReceiptBus;

  const upsertRun = (parentThreadId: ThreadId, run: SubagentRun, createdAt = run.updatedAt) =>
    orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: serverCommandId("upsert"),
      threadId: parentThreadId,
      subagentRun: run,
      createdAt,
    });

  const detachVisibleThreadsFromRun = (run: SubagentRun) =>
    Effect.gen(function* () {
      if (!run.worktreePath && !run.branch) {
        return;
      }
      const readModel = yield* orchestrationEngine.getReadModel();
      const impactedThreads = readModel.threads.filter(
        (thread) =>
          thread.id !== run.subagentThreadId &&
          ((run.worktreePath !== null && thread.worktreePath === run.worktreePath) ||
            (run.branch !== null && thread.branch === run.branch)),
      );
      for (const thread of impactedThreads) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: serverCommandId("detach-cleaned-worktree"),
            threadId: thread.id,
            branch: null,
            worktreePath: null,
          })
          .pipe(Effect.catch(() => Effect.void));
      }
    });

  const cleanupResources = (input: {
    readonly projectRoot: string;
    readonly run: SubagentRun;
    readonly force: boolean;
  }) =>
    Effect.gen(function* () {
      if (input.run.subagentThreadId) {
        yield* providerService
          .stopSession({ threadId: input.run.subagentThreadId })
          .pipe(Effect.catch(() => Effect.void));
      }
      if (input.run.worktreePath) {
        yield* git.removeWorktree({
          cwd: input.projectRoot,
          path: input.run.worktreePath,
          force: input.force,
        });
      }
      if (input.run.branch) {
        yield* git.deleteLocalBranch({
          cwd: input.projectRoot,
          branch: input.run.branch,
          force: input.force,
        });
      }
      yield* detachVisibleThreadsFromRun(input.run);
      if (input.run.subagentThreadId) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.delete",
            commandId: serverCommandId("delete-thread"),
            threadId: input.run.subagentThreadId,
          })
          .pipe(Effect.catch(() => Effect.void));
      }
    });

  const processStartRequested = (
    event: Extract<SubagentDomainEvent, { type: "thread.subagent-start-requested" }>,
  ) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const parentThread = readModel.threads.find((thread) => thread.id === event.payload.threadId);
      const existingRun = parentThread ? findRun(parentThread, event.payload.runId) : null;
      if (!parentThread || !existingRun) {
        return;
      }

      const skillOption = yield* skillCatalog.getSkillById(event.payload.skillId);
      if (Option.isNone(skillOption)) {
        yield* upsertRun(parentThread.id, {
          ...existingRun,
          status: "failed",
          lastError: `Unknown skill '${event.payload.skillId}'.`,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const skill = skillOption.value;
      const projectRoot = findProjectRoot(readModel, parentThread);
      const workspaceCwd = resolveThreadWorkspaceCwd({
        thread: parentThread,
        projects: readModel.projects,
      });
      if (!projectRoot || !workspaceCwd) {
        yield* upsertRun(parentThread.id, {
          ...existingRun,
          skillTitle: skill.title,
          status: "failed",
          lastError: "Could not resolve the parent thread workspace.",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        return;
      }

      let createdThreadId: ThreadId | null = null;
      let nextRun: SubagentRun = {
        ...existingRun,
        skillTitle: skill.title,
      };

      try {
        const baseBranch = parentThread.branch ?? (yield* git.status({ cwd: projectRoot })).branch;
        if (!baseBranch) {
          throw new Error("Could not resolve a git base branch for the sub-agent worktree.");
        }

        const branchName = buildSubagentBranchName(skill.id, existingRun.id);
        const worktree = yield* git.createWorktree({
          cwd: projectRoot,
          branch: baseBranch,
          newBranch: branchName,
          path: null,
        });

        createdThreadId = ThreadId.makeUnsafe(crypto.randomUUID());
        nextRun = {
          ...nextRun,
          subagentThreadId: createdThreadId,
          branch: worktree.worktree.branch,
          worktreePath: worktree.worktree.path,
          status: "running",
          updatedAt: new Date().toISOString(),
        };
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: serverCommandId("create-thread"),
          threadId: createdThreadId,
          projectId: parentThread.projectId,
          title: buildSubagentThreadTitle(skill, event.payload.task),
          model: parentThread.model,
          runtimeMode: parentThread.runtimeMode,
          interactionMode: "default",
          threadKind: "subagent",
          parentThreadId: parentThread.id,
          branch: worktree.worktree.branch,
          worktreePath: worktree.worktree.path,
          createdAt: event.payload.createdAt,
        });
        yield* upsertRun(parentThread.id, nextRun);
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: serverCommandId("turn-start"),
          threadId: createdThreadId,
          message: {
            messageId: MessageId.makeUnsafe(crypto.randomUUID()),
            role: "user",
            text: event.payload.task,
            attachments: [],
          },
          model: parentThread.model,
          runtimeMode: parentThread.runtimeMode,
          interactionMode: "default",
          developerInstructions: buildSubagentDeveloperInstructions(skill),
          createdAt: event.payload.createdAt,
        });
      } catch (cause) {
        if (nextRun.worktreePath || nextRun.branch) {
          yield* cleanupResources({
            projectRoot,
            run: nextRun,
            force: true,
          }).pipe(Effect.catch(() => Effect.void));
        }
        yield* upsertRun(parentThread.id, {
          ...nextRun,
          status: "failed",
          branch: null,
          worktreePath: null,
          subagentThreadId: createdThreadId,
          lastError: cause instanceof Error ? cause.message : String(cause),
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      }
    });

  const processQuiescedReceipt = (receipt: TurnProcessingQuiescedReceipt) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const hiddenThread = readModel.threads.find(
        (thread) =>
          thread.id === receipt.threadId &&
          thread.threadKind === "subagent" &&
          typeof thread.parentThreadId === "string",
      );
      if (!hiddenThread || !hiddenThread.parentThreadId) {
        return;
      }
      const parentThread = readModel.threads.find(
        (thread) => thread.id === hiddenThread.parentThreadId,
      );
      if (!parentThread) {
        return;
      }
      const run =
        parentThread.subagentRuns?.find(
          (candidate) =>
            candidate.subagentThreadId === hiddenThread.id &&
            (candidate.status === "preparing" || candidate.status === "running"),
        ) ?? null;
      if (!run) {
        return;
      }

      const assistantMessage =
        hiddenThread.messages.findLast(
          (message) => message.role === "assistant" && message.turnId === receipt.turnId,
        ) ??
        hiddenThread.messages.findLast((message) => message.role === "assistant") ??
        null;
      const changedFiles =
        hiddenThread.checkpoints
          .find((checkpoint) => checkpoint.turnId === receipt.turnId)
          ?.files.map((file) => file.path) ?? [];
      const report = assistantMessage?.text
        ? synthesizeReport(assistantMessage.text, changedFiles)
        : null;

      yield* providerService
        .stopSession({ threadId: hiddenThread.id })
        .pipe(Effect.catch(() => Effect.void));
      yield* upsertRun(parentThread.id, {
        ...run,
        status: report ? "report_ready" : "failed",
        report,
        lastError: report ? null : "The sub-agent finished without a structured final report.",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    });

  const processReportAccepted = (
    event: Extract<SubagentDomainEvent, { type: "thread.subagent-report-accepted" }>,
  ) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const parentThread = readModel.threads.find((thread) => thread.id === event.payload.threadId);
      const run = parentThread ? findRun(parentThread, event.payload.runId) : null;
      if (!parentThread || !run) {
        return;
      }
      const projectRoot = findProjectRoot(readModel, parentThread);
      const acceptedAt = new Date().toISOString();
      if (!projectRoot || !run.worktreePath) {
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "accepted",
          acceptedAt,
          updatedAt: acceptedAt,
        });
        return;
      }
      const status = yield* git
        .status({ cwd: run.worktreePath })
        .pipe(Effect.catch(() => Effect.succeed(EMPTY_GIT_STATUS)));
      if (status.hasWorkingTreeChanges) {
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "retained",
          acceptedAt,
          updatedAt: acceptedAt,
        });
        return;
      }
      try {
        yield* cleanupResources({
          projectRoot,
          run,
          force: false,
        });
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "cleaned_up",
          acceptedAt,
          branch: null,
          worktreePath: null,
          updatedAt: acceptedAt,
        });
      } catch (cause) {
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "cleanup_failed",
          acceptedAt,
          lastError: cause instanceof Error ? cause.message : String(cause),
          updatedAt: acceptedAt,
        });
      }
    });

  const processCleanupRequested = (
    event: Extract<SubagentDomainEvent, { type: "thread.subagent-cleanup-requested" }>,
  ) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const parentThread = readModel.threads.find((thread) => thread.id === event.payload.threadId);
      const run = parentThread ? findRun(parentThread, event.payload.runId) : null;
      const projectRoot = parentThread ? findProjectRoot(readModel, parentThread) : null;
      if (!parentThread || !run || !projectRoot) {
        return;
      }
      try {
        yield* cleanupResources({
          projectRoot,
          run,
          force: true,
        });
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "cleaned_up",
          branch: null,
          worktreePath: null,
          updatedAt: new Date().toISOString(),
        });
      } catch (cause) {
        yield* upsertRun(parentThread.id, {
          ...run,
          status: "cleanup_failed",
          lastError: cause instanceof Error ? cause.message : String(cause),
          updatedAt: new Date().toISOString(),
        });
      }
    });

  const processInput = (input: SubagentCoordinatorInput) =>
    input.kind === "event"
      ? input.event.type === "thread.subagent-start-requested"
        ? processStartRequested(input.event)
        : input.event.type === "thread.subagent-report-accepted"
          ? processReportAccepted(input.event)
          : processCleanupRequested(input.event)
      : processQuiescedReceipt(input.receipt);

  const processInputSafely = (input: SubagentCoordinatorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("subagent coordinator failed to process input", {
          kind: input.kind,
          cause: Cause.pretty(cause),
          ...(input.kind === "event"
            ? { eventType: input.event.type }
            : { receiptType: input.receipt.type, threadId: input.receipt.threadId }),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: SubagentCoordinatorShape["start"] = Effect.all(
    [
      Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.subagent-start-requested" &&
            event.type !== "thread.subagent-report-accepted" &&
            event.type !== "thread.subagent-cleanup-requested"
          ) {
            return Effect.void;
          }
          return worker.enqueue({ kind: "event", event });
        }),
      ),
      Effect.forkScoped(
        Stream.runForEach(runtimeReceiptBus.stream, (receipt) => {
          if (receipt.type !== "turn.processing.quiesced") {
            return Effect.void;
          }
          return worker.enqueue({ kind: "receipt", receipt });
        }),
      ),
    ],
    { concurrency: 1 },
  ).pipe(Effect.asVoid);

  return {
    start,
  } satisfies SubagentCoordinatorShape;
});

export const SubagentCoordinatorLive = Layer.effect(SubagentCoordinator, makeSubagentCoordinator);
