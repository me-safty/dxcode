import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationProjectShell,
  type ProjectScript,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { randomBytes, randomUUID } from "node:crypto";

import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ExternalIntegrationRepository } from "../persistence/Services/ExternalIntegrations.ts";
import { ProjectSetupScriptRunner } from "../project/Services/ProjectSetupScriptRunner.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import {
  defaultBaseRefForProfile,
  type IntakeProjectProfile,
  loadIntakeProfiles,
  setupScriptToProjectScript,
} from "./profiles.ts";
import {
  applyTeamAppMuteCommand,
  mentionsNonTeamAppSlackUser,
  mentionsTeamAppUser,
  shouldIgnoreTeamAppMessage,
  teamAppMuteCommandReaction,
} from "./teamAppMessages.ts";

type ResolvedProject = Pick<
  OrchestrationProject | OrchestrationProjectShell,
  "id" | "defaultModelSelection" | "scripts"
>;

export interface ExternalSlackNotificationLink {
  readonly externalThreadId: string;
  readonly channelId: string;
  readonly threadTs: string;
  readonly primaryExternalMessageId: string;
  readonly url?: string | undefined;
}

export interface ExternalIntakeMessage {
  readonly source: "slack" | "support_email";
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly text: string;
  readonly title: string;
  readonly url?: string | undefined;
  readonly receivedAt: string;
  readonly profile?: IntakeProjectProfile | undefined;
  readonly projectHintText?: string | undefined;
  readonly slack?:
    | {
        readonly rawText?: string | undefined;
        readonly isMention?: boolean | undefined;
        readonly botUserId?: string | undefined;
        readonly botUserName?: string | undefined;
      }
    | undefined;
  readonly notificationSlackLink?: ExternalSlackNotificationLink | undefined;
}

export type ExternalIntakeResult =
  | {
      readonly status: "ignored";
      readonly reason: string;
      readonly reaction?: string | undefined;
    }
  | {
      readonly status: "continued";
      readonly t3ThreadId: ThreadId;
      readonly acceptedAt: string;
    }
  | {
      readonly status: "created";
      readonly projectId: ProjectId;
      readonly t3ThreadId: ThreadId;
      readonly branch: string;
      readonly worktreePath: string;
      readonly acceptedAt: string;
      readonly environmentId?: string | undefined;
    };

export interface ExternalIntakeShape {
  readonly handleMessage: (
    input: ExternalIntakeMessage,
  ) => Effect.Effect<ExternalIntakeResult, Error>;
}

export class ExternalIntake extends Context.Service<ExternalIntake, ExternalIntakeShape>()(
  "t3/externalIntake/ExternalIntake",
) {}

const DEFAULT_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.5",
  options: [{ id: "fastMode", value: true }],
} as const satisfies ModelSelection;

function currentIsoTimestamp() {
  return DateTime.formatIso(DateTime.toUtc(DateTime.nowUnsafe()));
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function defaultModelSelectionFromEnv(): ModelSelection | undefined {
  const instanceId = envValue("T3_DEFAULT_PROVIDER_INSTANCE_ID");
  const model = envValue("T3_DEFAULT_MODEL");
  if (instanceId === undefined || model === undefined) return undefined;
  return { instanceId: ProviderInstanceId.make(instanceId), model };
}

function projectTitleFromWorkspace(workspaceRoot: string) {
  const segments = workspaceRoot.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? "Project";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMentionsAlias(text: string, alias: string) {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i").test(text);
}

function scriptListWithProfileScript(
  existing: readonly ProjectScript[],
  profile: IntakeProjectProfile | null,
): ProjectScript[] {
  const setupScript = profile === null ? null : setupScriptToProjectScript(profile);
  if (setupScript === null) return [...existing];
  const index = existing.findIndex((script) => script.id === setupScript.id);
  if (index < 0) return [...existing, setupScript];
  return existing.map((script) => (script.id === setupScript.id ? setupScript : script));
}

function scriptsEqual(left: readonly ProjectScript[], right: readonly ProjectScript[]) {
  if (left.length !== right.length) return false;
  return left.every((script, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      script.id === other.id &&
      script.name === other.name &&
      script.command === other.command &&
      script.icon === other.icon &&
      script.runOnWorktreeCreate === other.runOnWorktreeCreate
    );
  });
}

function buildInitialPrompt(input: ExternalIntakeMessage) {
  const profile = input.profile;
  const supportPrompt = profile?.supportEmail?.triagePrompt;
  const supportAgentPrompt =
    profile?.supportEmail?.agentPrompt ??
    [
      "- This task was started from support email intake.",
      "- Treat the email content as the source message.",
      "- If the message is not a real user-reported issue, say so clearly and stop.",
      "- If triage shows a real product bug, create a Linear issue using the available Linear tools and include the issue link.",
    ].join("\n");

  const genericAgentPrompt = [
    "- Work in the prepared worktree for this thread.",
    "- If you make code changes, create a pull request and include the PR URL in your final response.",
    "- Keep replies concise and include links to external artifacts you create.",
  ].join("\n");

  return [
    `External request source: ${input.source}`,
    `Title: ${input.title}`,
    ...(input.url !== undefined ? [`External URL: ${input.url}`] : []),
    "",
    input.source === "support_email" ? supportAgentPrompt : genericAgentPrompt,
    ...(supportPrompt !== undefined ? ["", supportPrompt] : []),
    "",
    "Request:",
    input.text,
  ].join("\n");
}

function buildFollowUpPrompt(input: ExternalIntakeMessage) {
  return [
    `Follow-up from ${input.source}.`,
    ...(input.url !== undefined ? [`External URL: ${input.url}`] : []),
    "",
    input.text,
  ].join("\n");
}

function mapUnknownToError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const makeExternalIntake = Effect.gen(function* () {
  const repository = yield* ExternalIntegrationRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const git = yield* GitVcsDriver;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
  const serverEnvironment = yield* ServerEnvironment;

  const profiles = loadIntakeProfiles();

  const resolveProject = (input: ExternalIntakeMessage) =>
    Effect.gen(function* () {
      if (input.profile !== undefined) {
        const existing = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
          input.profile.workspaceRoot,
        );
        return {
          profile: input.profile,
          existing,
          workspaceRoot: input.profile.workspaceRoot,
          title: input.profile.title ?? projectTitleFromWorkspace(input.profile.workspaceRoot),
        };
      }

      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const hintText = `${input.projectHintText ?? ""}\n${input.text}`.toLowerCase();
      const profile = profiles.find((candidate) =>
        candidate.aliases.some((alias) => textMentionsAlias(hintText, alias)),
      );
      if (profile !== undefined) {
        const existing = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
          profile.workspaceRoot,
        );
        return {
          profile,
          existing,
          workspaceRoot: profile.workspaceRoot,
          title: profile.title ?? projectTitleFromWorkspace(profile.workspaceRoot),
        };
      }

      const mentionedProject = snapshot.projects.find((project) => {
        const aliases = [
          project.title,
          project.repositoryIdentity?.displayName,
          project.repositoryIdentity?.name,
          project.repositoryIdentity?.locator.remoteName,
        ].flatMap((alias) => (alias ? [alias] : []));
        return aliases.some((alias) => textMentionsAlias(hintText, alias));
      });
      if (mentionedProject !== undefined) {
        return {
          profile: null,
          existing: Option.some(mentionedProject),
          workspaceRoot: mentionedProject.workspaceRoot,
          title: mentionedProject.title,
        };
      }

      if (snapshot.projects.length === 1) {
        const onlyProject = snapshot.projects[0]!;
        return {
          profile: null,
          existing: Option.some(onlyProject),
          workspaceRoot: onlyProject.workspaceRoot,
          title: onlyProject.title,
        };
      }

      throw new Error(
        snapshot.projects.length === 0
          ? "No T3 projects are configured yet."
          : "Could not resolve a project from the request. Mention a configured project name.",
      );
    });

  const ensureProject = (input: {
    readonly profile: IntakeProjectProfile | null;
    readonly existing: Option.Option<ResolvedProject>;
    readonly workspaceRoot: string;
    readonly title: string;
    readonly now: string;
  }) =>
    Effect.gen(function* () {
      const modelSelection =
        input.profile?.modelSelection ??
        (Option.isSome(input.existing) ? input.existing.value.defaultModelSelection : null) ??
        defaultModelSelectionFromEnv() ??
        DEFAULT_MODEL_SELECTION;

      const projectId = Option.isSome(input.existing)
        ? input.existing.value.id
        : ProjectId.make(randomUUID());

      if (Option.isNone(input.existing)) {
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`external-intake:project:create:${projectId}`),
          projectId,
          title: input.title,
          workspaceRoot: input.workspaceRoot,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: modelSelection,
          createdAt: input.now,
        });
      }

      const projectShell = Option.isSome(input.existing)
        ? input.existing.value
        : yield* projectionSnapshotQuery
            .getProjectShellById(projectId)
            .pipe(Effect.map((project) => Option.getOrUndefined(project) ?? null));
      const currentScripts = projectShell?.scripts ?? [];
      const nextScripts = scriptListWithProfileScript(currentScripts, input.profile);
      if (input.profile !== null && !scriptsEqual(currentScripts, nextScripts)) {
        yield* orchestrationEngine.dispatch({
          type: "project.meta.update",
          commandId: CommandId.make(`external-intake:project:scripts:${projectId}`),
          projectId,
          scripts: nextScripts,
        });
      }

      return { projectId, modelSelection };
    });

  const continueLinkedThread = (input: {
    readonly message: ExternalIntakeMessage;
    readonly threadId: ThreadId;
    readonly now: string;
  }) =>
    Effect.gen(function* () {
      const messageNonce = randomUUID();
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(
          `external-intake:thread:continue:${input.message.externalMessageId}:${messageNonce}`,
        ),
        threadId: input.threadId,
        message: {
          messageId: MessageId.make(`external:${input.message.externalMessageId}:${messageNonce}`),
          role: "user",
          text: buildFollowUpPrompt(input.message),
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: input.now,
      });
      return {
        status: "continued" as const,
        t3ThreadId: input.threadId,
        acceptedAt: input.now,
      };
    });

  const createLinkedThread = (message: ExternalIntakeMessage, now: string) =>
    Effect.gen(function* () {
      const resolvedProject = yield* resolveProject(message);
      const { projectId, modelSelection } = yield* ensureProject({
        ...resolvedProject,
        now,
      });
      const baseRef = defaultBaseRefForProfile(resolvedProject.profile);
      const branch = buildTemporaryWorktreeBranchName((byteLength) =>
        randomBytes(byteLength).toString("hex"),
      );
      const worktree = yield* git.createWorktree({
        cwd: resolvedProject.workspaceRoot,
        refName: baseRef,
        newRefName: branch,
        path: null,
        refreshBaseFromOrigin: true,
      });
      const threadId = ThreadId.make(randomUUID());

      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`external-intake:thread:create:${message.externalMessageId}`),
        threadId,
        projectId,
        title: message.title,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: worktree.worktree.refName,
        worktreePath: worktree.worktree.path,
        createdAt: now,
      });

      yield* projectSetupScriptRunner
        .runForThread({
          threadId,
          projectId,
          projectCwd: resolvedProject.workspaceRoot,
          worktreePath: worktree.worktree.path,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("external intake failed to launch setup script", {
              source: message.source,
              externalThreadId: message.externalThreadId,
              threadId: String(threadId),
              projectId: String(projectId),
              message: error.message,
            }),
          ),
        );

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`external-intake:turn:start:${message.externalMessageId}`),
        threadId,
        message: {
          messageId: MessageId.make(`external:${message.externalMessageId}`),
          role: "user",
          text: buildInitialPrompt(message),
          attachments: [],
        },
        modelSelection,
        titleSeed: message.title,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      });

      yield* repository.upsertThreadLink({
        source: message.source,
        externalThreadId: message.externalThreadId,
        t3ThreadId: threadId,
        projectId,
        primaryExternalMessageId: message.externalMessageId,
        url: message.url ?? null,
        muted: false,
        metadata: {
          title: message.title,
          profileId: resolvedProject.profile?.id,
        },
        createdAt: now,
        updatedAt: now,
      });

      if (message.notificationSlackLink !== undefined) {
        yield* repository.upsertThreadLink({
          source: "slack",
          externalThreadId: message.notificationSlackLink.externalThreadId,
          t3ThreadId: threadId,
          projectId,
          primaryExternalMessageId: message.notificationSlackLink.primaryExternalMessageId,
          url: message.notificationSlackLink.url ?? null,
          muted: false,
          metadata: {
            source: message.source,
            channelId: message.notificationSlackLink.channelId,
            threadTs: message.notificationSlackLink.threadTs,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      const environment = yield* serverEnvironment.getDescriptor;
      return {
        status: "created" as const,
        projectId,
        t3ThreadId: threadId,
        branch: worktree.worktree.refName,
        worktreePath: worktree.worktree.path,
        acceptedAt: now,
        environmentId: String(environment.environmentId),
      };
    });

  const handleSlackPolicy = (input: {
    readonly message: ExternalIntakeMessage;
    readonly existingMuted: boolean;
    readonly hasExistingLink: boolean;
    readonly now: string;
  }) =>
    Effect.gen(function* () {
      if (input.message.source !== "slack") return null;
      const body = input.message.text;
      const mentionsBot =
        mentionsTeamAppUser({
          body,
          botUserId: input.message.slack?.botUserId ?? envValue("SLACK_BOT_USER_ID"),
          botUserName: input.message.slack?.botUserName ?? envValue("SLACK_BOT_USERNAME"),
        }) ||
        input.message.slack?.isMention === true ||
        (input.message.slack?.rawText !== undefined &&
          mentionsTeamAppUser({
            body: input.message.slack.rawText,
            botUserId: input.message.slack?.botUserId ?? envValue("SLACK_BOT_USER_ID"),
            botUserName: input.message.slack?.botUserName ?? envValue("SLACK_BOT_USERNAME"),
          }));
      const muteCommand = applyTeamAppMuteCommand({
        body,
        isThreadMuted: input.existingMuted,
        mentionsAiEngineer: mentionsBot,
      });
      if (muteCommand.command !== undefined) {
        if (input.hasExistingLink && muteCommand.changed) {
          yield* repository.setThreadMuted({
            source: "slack",
            externalThreadId: input.message.externalThreadId,
            muted: muteCommand.muted,
            updatedAt: input.now,
          });
        }
        return {
          status: "ignored" as const,
          reason: `slack_thread_${muteCommand.command}`,
          reaction: teamAppMuteCommandReaction(muteCommand.command),
        };
      }

      const decision = shouldIgnoreTeamAppMessage({
        body,
        isThreadMuted: input.existingMuted,
        mentionsAiEngineer: mentionsBot,
      });
      if (decision.ignore) {
        return {
          status: "ignored" as const,
          reason: `slack_thread_${decision.reason}`,
        };
      }

      if (
        mentionsNonTeamAppSlackUser({
          body,
          botUserId: input.message.slack?.botUserId ?? envValue("SLACK_BOT_USER_ID"),
        }) ||
        (input.message.slack?.rawText !== undefined &&
          mentionsNonTeamAppSlackUser({
            body: input.message.slack.rawText,
            botUserId: input.message.slack?.botUserId ?? envValue("SLACK_BOT_USER_ID"),
          }))
      ) {
        return { status: "ignored" as const, reason: "slack_thread_other_user_mention" };
      }

      if (!input.hasExistingLink && !mentionsBot) {
        return { status: "ignored" as const, reason: "slack_ambient_without_thread" };
      }

      return null;
    });

  const handleMessage: ExternalIntakeShape["handleMessage"] = (message) =>
    Effect.gen(function* () {
      const now = currentIsoTimestamp();
      const existing = yield* repository.getThreadLink({
        source: message.source,
        externalThreadId: message.externalThreadId,
      });
      const policyDecision = yield* handleSlackPolicy({
        message,
        existingMuted: Option.isSome(existing) ? existing.value.muted : false,
        hasExistingLink: Option.isSome(existing),
        now,
      });
      if (policyDecision !== null) {
        return policyDecision;
      }

      if (Option.isSome(existing)) {
        return yield* continueLinkedThread({
          message,
          threadId: existing.value.t3ThreadId,
          now,
        });
      }

      return yield* createLinkedThread(message, now);
    }).pipe(Effect.mapError(mapUnknownToError));

  return { handleMessage } satisfies ExternalIntakeShape;
});

export const ExternalIntakeLive = Layer.effect(ExternalIntake, makeExternalIntake);
