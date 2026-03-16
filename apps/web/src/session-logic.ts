import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type TurnId,
} from "@t3tools/contracts";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  ThreadSession,
  TurnDiffSummary,
} from "./types";

export type ProviderPickerKind = ProviderKind | "cursor";

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = [
  { value: "codex", label: "Codex", available: true },
  { value: "claudeCode", label: "Claude Code", available: true },
  { value: "cursor", label: "Cursor", available: false },
];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
}

export type AgentTeamsTaskStatus =
  | "lead"
  | "running"
  | "idle"
  | "awaitingApproval"
  | "completed"
  | "failed"
  | "stopped";

export interface AgentTeamsActivity {
  id: string;
  kind: string;
  updatedAt: string;
  label: string;
  detail?: string;
  status?: Exclude<AgentTeamsTaskStatus, "lead">;
  taskId?: string;
  toolUseId?: string;
  lastToolName?: string;
}

export interface AgentTeamsMember {
  id: string;
  label: string;
  status: Exclude<AgentTeamsTaskStatus, "lead">;
  updatedAt: string;
  startedAt: string;
  detail?: string;
  agentId?: string;
  agentName?: string;
  agentColor?: string;
  agentType?: string;
  teamName?: string;
  taskId?: string;
  toolUseId?: string;
  teammateName?: string;
  teammateMode?: string;
  planModeRequired?: boolean;
  awaitingLeaderApproval?: boolean;
  activities: AgentTeamsActivity[];
}

export interface AgentTeamsRun {
  id: string;
  label: string;
  status: Exclude<AgentTeamsTaskStatus, "lead">;
  startedAt: string;
  endedAt?: string;
  startedActivityId: string;
  endedActivityId?: string;
  teamName?: string;
  teammateMode?: string;
  members: AgentTeamsMember[];
  activeCount: number;
  pendingApprovalCount: number;
}

export interface AgentTeamsState {
  leadLabel: string;
  runs: AgentTeamsRun[];
  activeRunId: string | null;
  hasTeamActivity: boolean;
  activeCount: number;
  pendingApprovalCount: number;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      detail?.includes("Unknown pending permission request")
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const candidates = ordered.filter((activity) => {
    if (activity.kind !== "turn.plan.updated") {
      return false;
    }
    if (!latestTurnId) {
      return true;
    }
    return activity.turnId === latestTurnId;
  });
  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return {
        id: matchingTurnPlan.id,
        createdAt: matchingTurnPlan.createdAt,
        updatedAt: matchingTurnPlan.updatedAt,
        turnId: matchingTurnPlan.turnId,
        planMarkdown: matchingTurnPlan.planMarkdown,
      };
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return {
    id: latestPlan.id,
    createdAt: latestPlan.createdAt,
    updatedAt: latestPlan.updatedAt,
    turnId: latestPlan.turnId,
    planMarkdown: latestPlan.planMarkdown,
  };
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  return ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => activity.kind !== "tool.started")
    .filter((activity) => activity.kind !== "task.started" && activity.kind !== "task.completed")
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .map((activity) => {
      const payload =
        activity.payload && typeof activity.payload === "object"
          ? (activity.payload as Record<string, unknown>)
          : null;
      const command = extractToolCommand(payload);
      const changedFiles = extractChangedFiles(payload);
      const title = extractToolTitle(payload);
      const entry: WorkLogEntry = {
        id: activity.id,
        createdAt: activity.createdAt,
        label: activity.summary,
        tone: activity.tone === "approval" ? "info" : activity.tone,
      };
      const itemType = extractWorkLogItemType(payload);
      const requestKind = extractWorkLogRequestKind(payload);
      if (payload && typeof payload.detail === "string" && payload.detail.length > 0) {
        const detail = stripTrailingExitCode(payload.detail).output;
        if (detail) {
          entry.detail = detail;
        }
      }
      if (command) {
        entry.command = command;
      }
      if (changedFiles.length > 0) {
        entry.changedFiles = changedFiles;
      }
      if (title) {
        entry.toolTitle = title;
      }
      if (itemType) {
        entry.itemType = itemType;
      }
      if (requestKind) {
        entry.requestKind = requestKind;
      }
      return entry;
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function extractToolCommand(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
  ];
  return candidates.find((candidate) => candidate !== null) ?? null;
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

type AgentTeamMetadata = {
  readonly agentId?: string;
  readonly agentName?: string;
  readonly agentColor?: string;
  readonly taskId?: string;
  readonly toolUseId?: string;
  readonly teammateName?: string;
  readonly teamName?: string;
  readonly agentType?: string;
  readonly parentSessionId?: string;
  readonly teammateMode?: string;
  readonly planModeRequired?: boolean;
  readonly awaitingLeaderApproval?: boolean;
};

function extractAgentTeamMetadata(payload: Record<string, unknown> | null): AgentTeamMetadata {
  const toolInput = asRecord(asRecord(payload?.data)?.input);
  const agentId = asTrimmedString(payload?.agentId);
  const agentName = asTrimmedString(payload?.agentName);
  const agentColor = asTrimmedString(payload?.agentColor);
  const taskId = asTrimmedString(payload?.taskId);
  const toolUseId = asTrimmedString(payload?.toolUseId);
  const teammateName =
    asTrimmedString(payload?.teammateName) ??
    asTrimmedString(payload?.agentName) ??
    asTrimmedString(toolInput?.name);
  const teamName = asTrimmedString(payload?.teamName) ?? asTrimmedString(toolInput?.team_name);
  const agentType =
    asTrimmedString(payload?.agentType) ?? asTrimmedString(toolInput?.subagent_type);
  const parentSessionId = asTrimmedString(payload?.parentSessionId);
  const teammateMode = asTrimmedString(payload?.teammateMode);
  const planModeRequired =
    typeof payload?.planModeRequired === "boolean" ? payload.planModeRequired : undefined;
  const awaitingLeaderApproval =
    typeof payload?.awaitingLeaderApproval === "boolean"
      ? payload.awaitingLeaderApproval
      : undefined;
  return {
    ...(agentId ? { agentId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentColor ? { agentColor } : {}),
    ...(taskId ? { taskId } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(teammateName ? { teammateName } : {}),
    ...(teamName ? { teamName } : {}),
    ...(agentType ? { agentType } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(teammateMode ? { teammateMode } : {}),
    ...(planModeRequired !== undefined ? { planModeRequired } : {}),
    ...(awaitingLeaderApproval !== undefined ? { awaitingLeaderApproval } : {}),
  };
}

function isAgentTeamMetadata(metadata: AgentTeamMetadata): boolean {
  return Boolean(metadata.teamName ?? metadata.teammateName ?? metadata.agentName);
}

function mergeAgentTeamMetadata(
  direct: AgentTeamMetadata,
  fromTool: AgentTeamMetadata | undefined,
): AgentTeamMetadata {
  return {
    ...fromTool,
    ...direct,
  };
}

function teamMemberLabel(metadata: AgentTeamMetadata): string {
  return (
    metadata.teammateName ??
    metadata.agentName ??
    metadata.agentType ??
    metadata.teamName ??
    "Teammate"
  );
}

function isPlaceholderAgentTeamsLabel(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "teammate" ||
    normalized === "agent" ||
    normalized === "subagent" ||
    normalized === "task"
  );
}

function inferTeammateLabelFromActivity(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): string | undefined {
  const detail = asTrimmedString(payload.detail);
  if (detail) {
    const detailMatch = /^(?<label>[^:]+):/.exec(detail);
    const candidate = detailMatch?.groups?.label?.trim();
    if (candidate) {
      return candidate;
    }
  }

  const summary = activity.summary.trim();
  const summaryMatch = /^(?<label>.+?)\s+(started|update|completed|failed|stopped|idle)$/i.exec(
    summary,
  );
  const summaryCandidate = summaryMatch?.groups?.label?.trim();
  if (summaryCandidate && summaryCandidate.toLowerCase() !== "teammate") {
    return summaryCandidate;
  }

  return undefined;
}

function agentTeamsMemberKey(metadata: AgentTeamMetadata, fallbackId: string): string {
  const stableLabel = !isPlaceholderAgentTeamsLabel(metadata.teammateName ?? metadata.agentName)
    ? (metadata.teammateName ?? metadata.agentName)
    : undefined;
  const labelKey = [metadata.teamName, stableLabel].filter(Boolean).join(":");
  const candidates = [
    metadata.agentId,
    labelKey || undefined,
    metadata.toolUseId,
    metadata.taskId,
    stableLabel,
    fallbackId,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate)) ?? fallbackId;
}

function agentTeamsStatusFromKind(kind: string): Exclude<AgentTeamsTaskStatus, "lead"> | undefined {
  switch (kind) {
    case "teammate.started":
    case "teammate.progress":
    case "tool.started":
    case "tool.updated":
      return "running";
    case "teammate.idle":
      return "idle";
    case "teammate.awaiting-approval":
      return "awaitingApproval";
    case "teammate.completed":
      return "completed";
    case "teammate.failed":
      return "failed";
    case "teammate.stopped":
      return "stopped";
    default:
      return undefined;
  }
}

function isTerminalAgentTeamsStatus(status: Exclude<AgentTeamsTaskStatus, "lead">): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

function agentTeamsActivityDetail(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): string | undefined {
  return (
    asTrimmedString(payload.summary) ??
    asTrimmedString(payload.detail) ??
    asTrimmedString(payload.lastToolName) ??
    (activity.kind.startsWith("tool.") ? activity.summary : undefined)
  );
}

function shouldTrackAgentTeamsActivity(
  activity: OrchestrationThreadActivity,
  metadata: AgentTeamMetadata,
): boolean {
  if (isAgentTeamMetadata(metadata)) {
    return true;
  }
  if (
    (activity.kind === "tool.started" ||
      activity.kind === "tool.updated" ||
      activity.kind === "tool.completed") &&
    typeof activity.payload === "object" &&
    activity.payload !== null &&
    (activity.payload as Record<string, unknown>).itemType === "collab_agent_tool_call"
  ) {
    return true;
  }
  return activity.kind.startsWith("teammate.");
}

type MutableAgentTeamsMember = Omit<AgentTeamsMember, "activities"> & {
  activities: AgentTeamsActivity[];
};

type MutableAgentTeamsRun = Omit<
  AgentTeamsRun,
  "members" | "status" | "activeCount" | "pendingApprovalCount"
> & {
  members: Map<string, MutableAgentTeamsMember>;
  order: string[];
};

function matchingMemberForMetadata(
  run: MutableAgentTeamsRun,
  metadata: AgentTeamMetadata,
): MutableAgentTeamsMember | undefined {
  for (const member of run.members.values()) {
    if (metadata.agentId && member.agentId === metadata.agentId) {
      return member;
    }
    if (metadata.toolUseId && member.toolUseId === metadata.toolUseId) {
      return member;
    }
    if (metadata.taskId && member.taskId === metadata.taskId) {
      return member;
    }
    if (
      metadata.teamName &&
      member.teamName === metadata.teamName &&
      (metadata.teammateName || metadata.agentName) &&
      (member.teammateName === metadata.teammateName ||
        member.teammateName === metadata.agentName ||
        member.agentName === metadata.agentName)
    ) {
      return member;
    }
  }
  return undefined;
}

export function deriveAgentTeamsState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  defaultAgent?: string | null,
): AgentTeamsState {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const toolMetadataByToolUseId = new Map<string, AgentTeamMetadata>();

  for (const activity of ordered) {
    if (!activity.payload || typeof activity.payload !== "object") {
      continue;
    }
    const payload = activity.payload as Record<string, unknown>;
    if (
      !(
        (activity.kind === "tool.started" ||
          activity.kind === "tool.updated" ||
          activity.kind === "tool.completed") &&
        payload.itemType === "collab_agent_tool_call"
      )
    ) {
      continue;
    }
    const metadata = extractAgentTeamMetadata(payload);
    if (!metadata.toolUseId) {
      continue;
    }
    toolMetadataByToolUseId.set(metadata.toolUseId, metadata);
  }

  const runs: MutableAgentTeamsRun[] = [];
  const activeRunByTeamKey = new Map<string, MutableAgentTeamsRun>();
  const runCountByTeamKey = new Map<string, number>();

  for (const activity of ordered) {
    if (!activity.payload || typeof activity.payload !== "object") {
      continue;
    }
    const payload = activity.payload as Record<string, unknown>;
    const directMetadata = extractAgentTeamMetadata(payload);
    const metadata = mergeAgentTeamMetadata(
      directMetadata,
      directMetadata.toolUseId ? toolMetadataByToolUseId.get(directMetadata.toolUseId) : undefined,
    );
    if (!shouldTrackAgentTeamsActivity(activity, metadata)) {
      continue;
    }

    const inferredLabel = inferTeammateLabelFromActivity(activity, payload);
    const metadataWithFallbackLabel =
      inferredLabel && !metadata.teammateName && !metadata.agentName
        ? mergeAgentTeamMetadata(metadata, { teammateName: inferredLabel })
        : metadata;

    const explicitTeamKey =
      metadataWithFallbackLabel.teamName ?? metadataWithFallbackLabel.parentSessionId;
    const teamKey = explicitTeamKey ?? (activity.turnId ? `turn:${activity.turnId}` : "agent-team");
    const status = agentTeamsStatusFromKind(activity.kind);

    let run = activeRunByTeamKey.get(teamKey);
    if (!run) {
      const runNumber = (runCountByTeamKey.get(teamKey) ?? 0) + 1;
      runCountByTeamKey.set(teamKey, runNumber);
      run = {
        id: `${teamKey}:${runNumber}`,
        label: metadataWithFallbackLabel.teamName ?? inferredLabel ?? `Team ${runNumber}`,
        startedAt: activity.createdAt,
        startedActivityId: activity.id,
        ...(metadataWithFallbackLabel.teamName
          ? { teamName: metadataWithFallbackLabel.teamName }
          : {}),
        ...(metadataWithFallbackLabel.teammateMode
          ? { teammateMode: metadataWithFallbackLabel.teammateMode }
          : {}),
        members: new Map<string, MutableAgentTeamsMember>(),
        order: [],
      };
      runs.push(run);
      activeRunByTeamKey.set(teamKey, run);
    } else if (!run.teamName && metadataWithFallbackLabel.teamName) {
      run.teamName = metadataWithFallbackLabel.teamName;
      run.label = metadataWithFallbackLabel.teamName;
    }

    if (!run.teammateMode && metadataWithFallbackLabel.teammateMode) {
      run.teammateMode = metadataWithFallbackLabel.teammateMode;
    }

    const memberId = agentTeamsMemberKey(metadataWithFallbackLabel, activity.id);
    const detail = agentTeamsActivityDetail(activity, payload);
    const nextLabel = teamMemberLabel(metadataWithFallbackLabel);

    let member =
      run.members.get(memberId) ?? matchingMemberForMetadata(run, metadataWithFallbackLabel);
    if (!member) {
      member = {
        id: memberId,
        label: nextLabel,
        status: status ?? "running",
        updatedAt: activity.createdAt,
        startedAt: activity.createdAt,
        ...(detail ? { detail } : {}),
        ...(metadataWithFallbackLabel.agentId
          ? { agentId: metadataWithFallbackLabel.agentId }
          : {}),
        ...(metadataWithFallbackLabel.agentName
          ? { agentName: metadataWithFallbackLabel.agentName }
          : {}),
        ...(metadataWithFallbackLabel.agentColor
          ? { agentColor: metadataWithFallbackLabel.agentColor }
          : {}),
        ...(metadataWithFallbackLabel.agentType
          ? { agentType: metadataWithFallbackLabel.agentType }
          : {}),
        ...(metadataWithFallbackLabel.teamName
          ? { teamName: metadataWithFallbackLabel.teamName }
          : {}),
        ...(metadataWithFallbackLabel.taskId ? { taskId: metadataWithFallbackLabel.taskId } : {}),
        ...(metadataWithFallbackLabel.toolUseId
          ? { toolUseId: metadataWithFallbackLabel.toolUseId }
          : {}),
        ...(metadataWithFallbackLabel.teammateName
          ? { teammateName: metadataWithFallbackLabel.teammateName }
          : {}),
        ...(metadataWithFallbackLabel.teammateMode
          ? { teammateMode: metadataWithFallbackLabel.teammateMode }
          : {}),
        ...(metadataWithFallbackLabel.planModeRequired !== undefined
          ? { planModeRequired: metadataWithFallbackLabel.planModeRequired }
          : {}),
        ...(metadataWithFallbackLabel.awaitingLeaderApproval !== undefined
          ? { awaitingLeaderApproval: metadataWithFallbackLabel.awaitingLeaderApproval }
          : {}),
        activities: [],
      };
      run.members.set(memberId, member);
      run.order.push(memberId);
    } else if (member.id !== memberId && metadataWithFallbackLabel.agentId) {
      const previousMemberId = member.id;
      run.members.delete(previousMemberId);
      run.members.set(memberId, {
        ...member,
        id: memberId,
      });
      run.order = run.order.map((candidateId) =>
        candidateId === previousMemberId ? memberId : candidateId,
      );
      member = run.members.get(memberId)!;
    }

    const nextStatus =
      status ??
      (member.status === "awaitingApproval" || isTerminalAgentTeamsStatus(member.status)
        ? member.status
        : "running");

    member.label = nextLabel;
    member.status = nextStatus;
    member.updatedAt = activity.createdAt;
    if (detail) {
      member.detail = detail;
    }
    if (metadataWithFallbackLabel.agentId) {
      member.agentId = metadataWithFallbackLabel.agentId;
    }
    if (metadataWithFallbackLabel.agentName) {
      member.agentName = metadataWithFallbackLabel.agentName;
    }
    if (metadataWithFallbackLabel.agentColor) {
      member.agentColor = metadataWithFallbackLabel.agentColor;
    }
    if (metadataWithFallbackLabel.agentType) {
      member.agentType = metadataWithFallbackLabel.agentType;
    }
    if (metadataWithFallbackLabel.teamName) {
      member.teamName = metadataWithFallbackLabel.teamName;
    }
    if (metadataWithFallbackLabel.taskId) {
      member.taskId = metadataWithFallbackLabel.taskId;
    }
    if (metadataWithFallbackLabel.toolUseId) {
      member.toolUseId = metadataWithFallbackLabel.toolUseId;
    }
    if (metadataWithFallbackLabel.teammateName) {
      member.teammateName = metadataWithFallbackLabel.teammateName;
    }
    if (metadataWithFallbackLabel.teammateMode) {
      member.teammateMode = metadataWithFallbackLabel.teammateMode;
    }
    if (metadataWithFallbackLabel.planModeRequired !== undefined) {
      member.planModeRequired = metadataWithFallbackLabel.planModeRequired;
    }
    if (metadataWithFallbackLabel.awaitingLeaderApproval !== undefined) {
      member.awaitingLeaderApproval = metadataWithFallbackLabel.awaitingLeaderApproval;
    } else if (nextStatus === "awaitingApproval") {
      member.awaitingLeaderApproval = true;
    } else if (isTerminalAgentTeamsStatus(nextStatus)) {
      member.awaitingLeaderApproval = false;
    }
    member.activities.push({
      id: activity.id,
      kind: activity.kind,
      updatedAt: activity.createdAt,
      label: activity.summary,
      ...(detail ? { detail } : {}),
      ...(status ? { status } : {}),
      ...(metadataWithFallbackLabel.taskId ? { taskId: metadataWithFallbackLabel.taskId } : {}),
      ...(metadataWithFallbackLabel.toolUseId
        ? { toolUseId: metadataWithFallbackLabel.toolUseId }
        : {}),
      ...(asTrimmedString(payload.lastToolName)
        ? { lastToolName: asTrimmedString(payload.lastToolName)! }
        : {}),
    });

    const hasActiveMembers = [...run.members.values()].some(
      (candidate) => !isTerminalAgentTeamsStatus(candidate.status),
    );
    if (!hasActiveMembers) {
      run.endedAt = activity.createdAt;
      run.endedActivityId = activity.id;
      activeRunByTeamKey.delete(teamKey);
    }
  }

  const leadLabel = asTrimmedString(defaultAgent) ?? "Lead";
  const finalizedRuns = runs
    .map<AgentTeamsRun>((run) => {
      const orderedMembers = run.order
        .map((memberId) => run.members.get(memberId))
        .filter((member): member is MutableAgentTeamsMember => member !== undefined)
        .toSorted(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
      const hasNamedMembers = orderedMembers.some(
        (member) => !isPlaceholderAgentTeamsLabel(member.label),
      );
      const members = hasNamedMembers
        ? orderedMembers.filter(
            (member) =>
              !isPlaceholderAgentTeamsLabel(member.label) ||
              member.activities.some((activity) => !activity.kind.startsWith("tool.")),
          )
        : orderedMembers;
      const activeCount = members.filter(
        (member) =>
          member.status === "running" ||
          member.status === "idle" ||
          member.status === "awaitingApproval",
      ).length;
      const pendingApprovalCount = members.filter(
        (member) => member.status === "awaitingApproval",
      ).length;
      const status =
        members.find((member) => member.status === "awaitingApproval")?.status ??
        members.find((member) => member.status === "running")?.status ??
        members.find((member) => member.status === "idle")?.status ??
        members.find((member) => member.status === "failed")?.status ??
        members.find((member) => member.status === "stopped")?.status ??
        members.find((member) => member.status === "completed")?.status ??
        "completed";

      const finalizedRun: AgentTeamsRun = {
        id: run.id,
        label: run.label,
        status,
        startedAt: run.startedAt,
        startedActivityId: run.startedActivityId,
        members,
        activeCount,
        pendingApprovalCount,
      };
      if (run.endedAt) {
        finalizedRun.endedAt = run.endedAt;
      }
      if (run.endedActivityId) {
        finalizedRun.endedActivityId = run.endedActivityId;
      }
      if (run.teamName) {
        finalizedRun.teamName = run.teamName;
      }
      if (run.teammateMode) {
        finalizedRun.teammateMode = run.teammateMode;
      }
      return finalizedRun;
    })
    .toSorted(
      (left, right) =>
        Number(Boolean(right.activeCount)) - Number(Boolean(left.activeCount)) ||
        right.startedAt.localeCompare(left.startedAt) ||
        left.id.localeCompare(right.id),
    );

  const activeRunId = finalizedRuns.find((run) => run.activeCount > 0)?.id ?? null;

  return {
    leadLabel,
    runs: finalizedRuns,
    activeRunId,
    hasTeamActivity: finalizedRuns.length > 0,
    activeCount: finalizedRuns.reduce((total, run) => total + run.activeCount, 0),
    pendingApprovalCount: finalizedRuns.reduce((total, run) => total + run.pendingApprovalCount, 0),
  };
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
