// @ts-nocheck
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
  ApprovalRequestId,
  type CanonicalItemType,
  type CanonicalRequestType,
  EventId,
  ProviderApprovalDecision,
  ProviderItemId,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import { Effect, FileSystem, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const require = createRequire(import.meta.url);

type RuntimeEventRawSource =
  | "codex.acp.session-update"
  | "codex.acp.permission"
  | "claude.acp.session-update"
  | "claude.acp.permission";

interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly toolCallId?: string;
  readonly options: ReadonlyArray<Record<string, unknown>>;
  readonly resolve: (response: RequestPermissionResponse) => void;
}

interface SessionTurnState {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface AcpSessionState {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind;
  readonly child: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection | null;
  readonly rawSourceSession: RuntimeEventRawSource;
  readonly rawSourcePermission: RuntimeEventRawSource;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly turns: Array<ProviderThreadTurnSnapshot>;
  sessionId: string;
  session: ProviderSession;
  activeTurn: SessionTurnState | undefined;
  currentModeId: string | undefined;
  configOptions: ReadonlyArray<Record<string, unknown>>;
  availableModes: ReadonlyArray<Record<string, unknown>>;
  availableCommands: ReadonlyArray<Record<string, unknown>>;
  bootModeId: string | undefined;
  replaying: boolean;
  stopping: boolean;
}

export interface AcpAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly manager?: any;
  readonly makeManager?: (...args: any[]) => any;
  readonly createQuery?: (input: any) => any;
}

interface AcpProviderBootstrapSettings {
  readonly binaryPath: string;
  readonly homePath?: string;
}

export interface AcpProviderConfig {
  readonly provider: ProviderKind;
  readonly packageName: string;
  readonly binName: string;
  readonly rawSourceSession: RuntimeEventRawSource;
  readonly rawSourcePermission: RuntimeEventRawSource;
  readonly readSettings: (settings: {
    readonly providers: {
      readonly codex: { readonly binaryPath: string; readonly homePath: string };
      readonly claudeAgent: { readonly binaryPath: string };
    };
  }) => AcpProviderBootstrapSettings;
  readonly configureEnvironment: (
    env: NodeJS.ProcessEnv,
    settings: AcpProviderBootstrapSettings,
  ) => NodeJS.ProcessEnv;
  readonly applyModelOptions?: (input: {
    readonly connection: ClientSideConnection;
    readonly sessionId: string;
    readonly configOptions: ReadonlyArray<Record<string, unknown>>;
    readonly modelSelection: NonNullable<ProviderSendTurnInput["modelSelection"]>;
  }) => Promise<void>;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function eventId() {
  return EventId.makeUnsafe(crypto.randomUUID());
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function trimString(value: unknown): string | undefined {
  const direct = asString(value)?.trim();
  return direct && direct.length > 0 ? direct : undefined;
}

function normalizePathEnv(env: NodeJS.ProcessEnv, executablePath: string) {
  if (!executablePath.includes("/") && !executablePath.includes("\\")) {
    return env;
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const current = env[pathKey] ?? process.env[pathKey] ?? "";
  return {
    ...env,
    [pathKey]: `${path.dirname(executablePath)}${path.delimiter}${current}`,
  };
}

function resolvePackageBin(packageName: string, binName: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    readonly bin?: string | Record<string, string>;
  };
  const binValue =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];
  if (!binValue) {
    throw new Error(`Package '${packageName}' does not expose bin '${binName}'.`);
  }
  return path.resolve(path.dirname(packageJsonPath), binValue);
}

function sessionNotFound(provider: ProviderKind, threadId: ThreadId) {
  return new ProviderAdapterSessionNotFoundError({
    provider,
    threadId,
  });
}

function requestError(provider: ProviderKind, method: string, detail: string, cause?: unknown) {
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function processError(provider: ProviderKind, threadId: ThreadId, detail: string, cause?: unknown) {
  return new ProviderAdapterProcessError({
    provider,
    threadId,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function classifyItemType(kind: unknown, title: string | undefined): CanonicalItemType {
  const normalizedKind = asString(kind)?.toLowerCase();
  const normalizedTitle = title?.toLowerCase() ?? "";

  if (normalizedKind === "execute") return "command_execution";
  if (normalizedKind === "edit" || normalizedKind === "move" || normalizedKind === "delete") {
    return "file_change";
  }
  if (normalizedKind === "fetch") return "web_search";
  if (normalizedKind === "think") return "reasoning";
  if (
    normalizedTitle.includes("agent") ||
    normalizedTitle.includes("subagent") ||
    normalizedTitle.includes("sub-agent")
  ) {
    return "collab_agent_tool_call";
  }

  return "dynamic_tool_call";
}

function classifyRequestType(kind: unknown): CanonicalRequestType {
  switch (asString(kind)?.toLowerCase()) {
    case "execute":
      return "command_execution_approval";
    case "read":
    case "search":
      return "file_read_approval";
    case "edit":
    case "move":
    case "delete":
      return "file_change_approval";
    default:
      return "dynamic_tool_call";
  }
}

function isGenericToolTitle(title: string | undefined) {
  const normalized = title?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    normalized === "tool" ||
    normalized === "tool call" ||
    normalized === "tool update" ||
    normalized === "tool completed" ||
    normalized === "terminal" ||
    normalized === "unknown tool" ||
    normalized === "other"
  );
}

function normalizeCommandValue(value: unknown): string | undefined {
  const direct = trimString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .map((entry) => trimString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function summarizeToolRawInput(rawInput: unknown): string | undefined {
  const input = asObject(rawInput);
  if (!input) {
    return undefined;
  }

  const command = normalizeCommandValue(input.command);
  const args = normalizeCommandValue(input.args);
  if (command && args) {
    return `${command} ${args}`;
  }
  if (command) {
    return command;
  }

  const query = trimString(input.query);
  if (query) {
    return query;
  }

  const pattern = trimString(input.pattern);
  const filePath =
    trimString(input.file_path) ??
    trimString(input.path) ??
    trimString(input.destination_path) ??
    trimString(input.source_path);
  if (pattern && filePath) {
    return `${pattern} in ${filePath}`;
  }
  if (filePath) {
    return filePath;
  }

  const url = trimString(input.url);
  if (url) {
    return url;
  }

  const description = trimString(input.description);
  if (description) {
    return description;
  }

  return undefined;
}

function summarizeToolLocations(
  locations: ReadonlyArray<{ readonly path?: string | null }> | null | undefined,
) {
  const paths = (locations ?? [])
    .map((entry) => trimString(entry.path))
    .filter((entry): entry is string => entry !== undefined);
  if (paths.length === 0) {
    return undefined;
  }
  if (paths.length === 1) {
    return paths[0];
  }
  const preview = paths.slice(0, 2).join(", ");
  return paths.length > 2 ? `${preview}, +${paths.length - 2} more` : preview;
}

function describeToolCallTitle(toolCall: {
  readonly kind?: unknown;
  readonly title?: string;
  readonly rawInput?: unknown;
  readonly locations?: ReadonlyArray<{ readonly path?: string | null }> | null;
}) {
  const title = trimString(toolCall.title);
  if (title && !isGenericToolTitle(title)) {
    return title;
  }

  const normalizedKind = trimString(toolCall.kind)?.toLowerCase();
  const hasCommand = summarizeToolRawInput(toolCall.rawInput) !== undefined;
  const hasLocation = summarizeToolLocations(toolCall.locations) !== undefined;

  if (normalizedKind === "execute" || hasCommand) return "Ran command";
  if (normalizedKind === "edit" || normalizedKind === "move" || normalizedKind === "delete") {
    return "Changed files";
  }
  if (normalizedKind === "read") return "Read file";
  if (normalizedKind === "search") return "Searched files";
  if (normalizedKind === "fetch") return "Fetched";
  if (normalizedKind === "think") return "Task";
  if (hasLocation) return "Tool call";
  return title;
}

function summarizeToolCall(toolCall: {
  readonly kind?: unknown;
  readonly title?: string;
  readonly rawInput?: unknown;
  readonly locations?: ReadonlyArray<{ readonly path?: string | null }> | null;
}) {
  const rawInputSummary = summarizeToolRawInput(toolCall.rawInput);
  if (rawInputSummary) {
    return rawInputSummary;
  }

  const location = summarizeToolLocations(toolCall.locations);
  if (location) {
    return location;
  }

  const title = trimString(toolCall.title);
  if (title && !isGenericToolTitle(title)) {
    return title;
  }

  if (toolCall.rawInput !== undefined) {
    const serialized = JSON.stringify(toolCall.rawInput);
    return serialized.length > 400 ? `${serialized.slice(0, 397)}...` : serialized;
  }

  return undefined;
}

function mapRuntimeItemStatus(status: unknown): "inProgress" | "completed" | "failed" | undefined {
  switch (asString(status)) {
    case "pending":
    case "in_progress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function mapTurnStatus(stopReason: string) {
  switch (stopReason) {
    case "cancelled":
      return "cancelled";
    case "refusal":
      return "failed";
    case "end_turn":
    case "max_tokens":
    case "max_turn_requests":
    default:
      return "completed";
  }
}

function normalizeUsage(update: { readonly used?: number; readonly size?: number }) {
  if (typeof update.used !== "number" || !Number.isFinite(update.used) || update.used < 0) {
    return undefined;
  }

  return {
    usedTokens: Math.max(0, Math.trunc(update.used)),
    lastUsedTokens: Math.max(0, Math.trunc(update.used)),
    ...(typeof update.size === "number" && Number.isFinite(update.size) && update.size > 0
      ? { maxTokens: Math.trunc(update.size) }
      : {}),
  } satisfies ThreadTokenUsageSnapshot;
}

function mapPlanStatus(status: unknown): "pending" | "inProgress" | "completed" {
  switch (asString(status)) {
    case "completed":
      return "completed";
    case "in_progress":
      return "inProgress";
    case "pending":
    default:
      return "pending";
  }
}

function pickApprovalResponse(
  options: ReadonlyArray<Record<string, unknown>>,
  decision: ProviderApprovalDecision,
): RequestPermissionResponse {
  if (decision === "cancel") {
    return {
      outcome: {
        outcome: "cancelled",
      },
    };
  }

  const normalizedOptions = options
    .map((option) => ({
      optionId: asString(option.optionId),
      name: asString(option.name)?.toLowerCase() ?? "",
      kind: asString(option.kind)?.toLowerCase() ?? "",
    }))
    .filter(
      (option): option is { optionId: string; name: string; kind: string } => !!option.optionId,
    );

  const findOption = (predicate: (option: (typeof normalizedOptions)[number]) => boolean) =>
    normalizedOptions.find(predicate)?.optionId;

  const allowOption =
    decision === "acceptForSession"
      ? findOption((option) => option.kind.includes("session") || option.name.includes("session"))
      : undefined;
  const acceptOption =
    allowOption ??
    findOption(
      (option) =>
        option.kind.includes("allow") ||
        option.kind.includes("approve") ||
        option.name.includes("allow") ||
        option.name.includes("approve") ||
        option.name.includes("accept"),
    ) ??
    normalizedOptions[0]?.optionId;

  if ((decision === "accept" || decision === "acceptForSession") && acceptOption) {
    return {
      outcome: {
        outcome: "selected",
        optionId: acceptOption,
      },
    };
  }

  const rejectOption =
    findOption(
      (option) =>
        option.kind.includes("deny") ||
        option.kind.includes("reject") ||
        option.name.includes("deny") ||
        option.name.includes("reject") ||
        option.name.includes("decline"),
    ) ?? normalizedOptions[0]?.optionId;

  if (decision === "decline" && rejectOption) {
    return {
      outcome: {
        outcome: "selected",
        optionId: rejectOption,
      },
    };
  }

  return {
    outcome: {
      outcome: "cancelled",
    },
  };
}

function findModeId(
  modes: ReadonlyArray<Record<string, unknown>>,
  interactionMode: "default" | "plan",
) {
  const entries = modes.map((mode) => ({
    id: asString(mode.id),
    title: asString(mode.title)?.toLowerCase() ?? "",
    description: asString(mode.description)?.toLowerCase() ?? "",
  }));

  if (interactionMode === "plan") {
    return entries.find((entry) => entry.id?.toLowerCase().includes("plan"))?.id;
  }

  return (
    entries.find((entry) => entry.id === "default")?.id ??
    entries.find((entry) => entry.title.includes("default"))?.id ??
    entries.find((entry) => !entry.id?.toLowerCase().includes("plan"))?.id
  );
}

function buildResumeCursor(sessionId: string) {
  return { sessionId };
}

function readResumeSessionId(resumeCursor: unknown) {
  const record = asObject(resumeCursor);
  return asString(record?.sessionId) ?? asString(record?.resume) ?? asString(record?.session);
}

const buildPromptBlocks = Effect.fn("buildPromptBlocks")(function* (
  input: ProviderSendTurnInput,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly attachmentsDir: string;
    readonly provider: ProviderKind;
  },
) {
  const blocks: ContentBlock[] = [];

  if (input.input?.trim()) {
    blocks.push({
      type: "text",
      text: input.input.trim(),
    });
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "image") {
      continue;
    }

    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: dependencies.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* Effect.fail(
        requestError(
          dependencies.provider,
          "session/prompt",
          `Invalid attachment id '${attachment.id}'.`,
        ),
      );
    }

    const bytes = yield* dependencies.fileSystem
      .readFile(attachmentPath)
      .pipe(
        Effect.mapError((cause) =>
          requestError(
            dependencies.provider,
            "session/prompt",
            toMessage(cause, "Failed to read attachment."),
            cause,
          ),
        ),
      );

    blocks.push({
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: attachment.mimeType,
      uri: attachment.name,
    });
  }

  return blocks;
});

function findConfigOption(
  configOptions: ReadonlyArray<Record<string, unknown>>,
  predicate: (option: Record<string, unknown>) => boolean,
) {
  return configOptions.find(predicate);
}

async function setBooleanConfigOption(input: {
  readonly connection: ClientSideConnection;
  readonly sessionId: string;
  readonly option: Record<string, unknown>;
  readonly value: boolean;
}) {
  const configId = asString(input.option.id);
  if (!configId) {
    return;
  }
  await input.connection.setSessionConfigOption({
    sessionId: input.sessionId,
    configId,
    type: "boolean",
    value: input.value,
  });
}

async function setSelectConfigOption(input: {
  readonly connection: ClientSideConnection;
  readonly sessionId: string;
  readonly option: Record<string, unknown>;
  readonly desiredValue: string;
}) {
  const configId = asString(input.option.id);
  const values = Array.isArray(input.option.values)
    ? input.option.values
        .map((value) => asObject(value))
        .filter((value): value is Record<string, unknown> => value !== undefined)
    : [];
  const selected =
    values.find((value) => asString(value.id) === input.desiredValue) ??
    values.find((value) => {
      const title = asString(value.title)?.toLowerCase();
      return title === input.desiredValue.toLowerCase();
    });

  const valueId = selected ? asString(selected.id) : undefined;
  if (!configId || !valueId) {
    return;
  }

  await input.connection.setSessionConfigOption({
    sessionId: input.sessionId,
    configId,
    value: valueId,
  });
}

async function applyCodexModelOptions(input: {
  readonly connection: ClientSideConnection;
  readonly sessionId: string;
  readonly configOptions: ReadonlyArray<Record<string, unknown>>;
  readonly modelSelection: NonNullable<ProviderSendTurnInput["modelSelection"]>;
}) {
  if (input.modelSelection.provider !== "codex") {
    return;
  }

  const fastMode = input.modelSelection.options?.fastMode;
  const reasoningEffort = input.modelSelection.options?.reasoningEffort;

  if (typeof fastMode === "boolean") {
    const option = findConfigOption(input.configOptions, (entry) => {
      const id = asString(entry.id)?.toLowerCase();
      const category = asString(entry.category)?.toLowerCase();
      return id === "fast_mode" || category === "service_tier";
    });
    if (option) {
      if (asString(option.type) === "boolean") {
        await setBooleanConfigOption({
          connection: input.connection,
          sessionId: input.sessionId,
          option,
          value: fastMode,
        });
      } else if (fastMode) {
        await setSelectConfigOption({
          connection: input.connection,
          sessionId: input.sessionId,
          option,
          desiredValue: "fast",
        });
      }
    }
  }

  if (reasoningEffort) {
    const option = findConfigOption(input.configOptions, (entry) => {
      const category = asString(entry.category)?.toLowerCase();
      const id = asString(entry.id)?.toLowerCase();
      return category === "thought_level" || id?.includes("thought") === true;
    });
    if (option) {
      await setSelectConfigOption({
        connection: input.connection,
        sessionId: input.sessionId,
        option,
        desiredValue: reasoningEffort,
      });
    }
  }
}

async function applyClaudeModelOptions(input: {
  readonly connection: ClientSideConnection;
  readonly sessionId: string;
  readonly configOptions: ReadonlyArray<Record<string, unknown>>;
  readonly modelSelection: NonNullable<ProviderSendTurnInput["modelSelection"]>;
}) {
  if (input.modelSelection.provider !== "claudeAgent") {
    return;
  }

  const fastMode = input.modelSelection.options?.fastMode;
  const effort = input.modelSelection.options?.effort;
  const thinking = input.modelSelection.options?.thinking;
  const contextWindow = input.modelSelection.options?.contextWindow;

  if (typeof fastMode === "boolean") {
    const option = findConfigOption(
      input.configOptions,
      (entry) => asString(entry.id)?.toLowerCase().includes("fast") === true,
    );
    if (option && asString(option.type) === "boolean") {
      await setBooleanConfigOption({
        connection: input.connection,
        sessionId: input.sessionId,
        option,
        value: fastMode,
      });
    }
  }

  if (effort) {
    const option = findConfigOption(input.configOptions, (entry) => {
      const category = asString(entry.category)?.toLowerCase();
      const id = asString(entry.id)?.toLowerCase();
      return category === "thought_level" || id?.includes("thought") === true;
    });
    if (option) {
      await setSelectConfigOption({
        connection: input.connection,
        sessionId: input.sessionId,
        option,
        desiredValue: effort,
      });
    }
  }

  if (typeof thinking === "boolean") {
    const option = findConfigOption(
      input.configOptions,
      (entry) => asString(entry.id)?.toLowerCase().includes("thinking") === true,
    );
    if (option && asString(option.type) === "boolean") {
      await setBooleanConfigOption({
        connection: input.connection,
        sessionId: input.sessionId,
        option,
        value: thinking,
      });
    }
  }

  if (contextWindow) {
    const option = findConfigOption(input.configOptions, (entry) => {
      const category = asString(entry.category)?.toLowerCase();
      const id = asString(entry.id)?.toLowerCase();
      return category === "context_window" || id?.includes("context") === true;
    });
    if (option) {
      await setSelectConfigOption({
        connection: input.connection,
        sessionId: input.sessionId,
        option,
        desiredValue: contextWindow,
      });
    }
  }
}

type SessionBootstrapResponse =
  | Awaited<ReturnType<ClientSideConnection["newSession"]>>
  | Awaited<ReturnType<ClientSideConnection["loadSession"]>>
  | Awaited<ReturnType<ClientSideConnection["unstable_resumeSession"]>>;

function cloneConfigOptions(
  configOptions: ReadonlyArray<Record<string, unknown>> | null | undefined,
) {
  return (configOptions ?? []).map((option) => ({ ...option }));
}

function cloneModes(modes: ReadonlyArray<Record<string, unknown>> | null | undefined) {
  return (modes ?? []).map((mode) => ({ ...mode }));
}

function applyBootstrapState(state: AcpSessionState, response: SessionBootstrapResponse) {
  state.configOptions = cloneConfigOptions(
    (response.configOptions as ReadonlyArray<Record<string, unknown>> | null | undefined) ?? [],
  );
  state.availableModes = cloneModes(
    (response.modes?.availableModes as ReadonlyArray<Record<string, unknown>> | null | undefined) ??
      [],
  );
  state.currentModeId = response.modes?.currentModeId ?? state.currentModeId;
  state.bootModeId = findModeId(state.availableModes, "default") ?? state.currentModeId;
}

const makeAcpProviderAdapter = Effect.fn("makeAcpProviderAdapter")(function* (
  config: AcpProviderConfig,
  options?: AcpAdapterLiveOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* Effect.service(ServerConfig);
  const services = yield* Effect.services<never>();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const serverSettingsService = yield* ServerSettingsService;
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);

  const sessions = new Map<ThreadId, AcpSessionState>();

  const runEffect = <A>(effect: Effect.Effect<A, never, never>) =>
    Effect.runPromise(effect.pipe(Effect.provideServices(services)));

  const logNativeEvent = (event: unknown, threadId: ThreadId | null) => {
    if (!nativeEventLogger) {
      return Promise.resolve();
    }
    return runEffect(nativeEventLogger.write(event, threadId));
  };

  const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
    runEffect(Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid));

  const makeBaseEvent = (input: {
    readonly state: AcpSessionState;
    readonly rawSource: RuntimeEventRawSource;
    readonly rawMethod: string;
    readonly rawPayload: unknown;
    readonly turnId?: TurnId;
    readonly itemId?: string;
    readonly requestId?: ApprovalRequestId;
  }): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
    eventId: eventId(),
    provider: input.state.provider,
    threadId: input.state.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: RuntimeItemId.makeUnsafe(input.itemId) } : {}),
    ...(input.requestId ? { requestId: RuntimeRequestId.makeUnsafe(input.requestId) } : {}),
    ...((input.itemId || input.requestId) && {
      providerRefs: {
        ...(input.itemId ? { providerItemId: ProviderItemId.makeUnsafe(input.itemId) } : {}),
        ...(input.requestId ? { providerRequestId: input.requestId } : {}),
      },
    }),
    raw: {
      source: input.rawSource,
      method: input.rawMethod,
      payload: input.rawPayload,
    },
  });

  const updateSessionSnapshot = (state: AcpSessionState, patch: Partial<ProviderSession>) => {
    state.session = {
      ...state.session,
      ...patch,
      updatedAt: nowIso(),
    };
  };

  const emitRuntimeWarning = (state: AcpSessionState, message: string, detail?: unknown) =>
    offerRuntimeEvent({
      ...makeBaseEvent({
        state,
        rawSource: state.rawSourceSession,
        rawMethod: "process/stderr",
        rawPayload: detail ?? { message },
      }),
      type: "runtime.warning",
      payload: {
        message,
        ...(detail !== undefined ? { detail } : {}),
      },
    });

  const emitSessionExit = async (
    state: AcpSessionState,
    exitKind: "graceful" | "error",
    reason: string,
  ) => {
    await offerRuntimeEvent({
      ...makeBaseEvent({
        state,
        rawSource: state.rawSourceSession,
        rawMethod: "session/exited",
        rawPayload: {
          reason,
          exitKind,
        },
      }),
      type: "session.exited",
      payload: {
        reason,
        exitKind,
        recoverable: exitKind === "error",
      },
    });
  };

  const stopSessionInternal = async (state: AcpSessionState, reason: string) => {
    if (state.stopping) {
      return;
    }

    state.stopping = true;
    sessions.delete(state.threadId);

    for (const pending of state.pendingApprovals.values()) {
      pending.resolve({
        outcome: {
          outcome: "cancelled",
        },
      });
    }
    state.pendingApprovals.clear();

    try {
      await state.connection.cancel({
        sessionId: state.sessionId,
      });
    } catch {
      // Best effort during shutdown.
    }

    try {
      if (typeof state.connection.unstable_closeSession === "function") {
        await state.connection.unstable_closeSession({
          sessionId: state.sessionId,
        });
      }
    } catch {
      // Best effort during shutdown.
    }

    updateSessionSnapshot(state, {
      status: "closed",
      activeTurnId: undefined,
    });

    await emitSessionExit(state, "graceful", reason);

    if (!state.child.killed) {
      state.child.kill();
    }
  };

  const completeTurn = async (state: AcpSessionState, turnId: TurnId, response: PromptResponse) => {
    const status = mapTurnStatus(response.stopReason);
    const turn = state.activeTurn;
    if (turn && turn.id === turnId) {
      state.turns.push({
        id: turn.id,
        items: [...turn.items],
      });
    }
    state.activeTurn = undefined;
    updateSessionSnapshot(state, {
      status: "ready",
      activeTurnId: undefined,
    });

    if (response.stopReason === "cancelled") {
      await offerRuntimeEvent({
        ...makeBaseEvent({
          state,
          rawSource: state.rawSourceSession,
          rawMethod: "session/prompt",
          rawPayload: response,
          turnId,
        }),
        type: "turn.aborted",
        payload: {
          reason: "Provider turn cancelled.",
        },
      });
      return;
    }

    await offerRuntimeEvent({
      ...makeBaseEvent({
        state,
        rawSource: state.rawSourceSession,
        rawMethod: "session/prompt",
        rawPayload: response,
        turnId,
      }),
      type: "turn.completed",
      payload: {
        state: status,
        stopReason: response.stopReason,
      },
    });
  };

  const failTurn = async (
    state: AcpSessionState,
    turnId: TurnId,
    method: string,
    cause: unknown,
  ) => {
    state.activeTurn = undefined;
    updateSessionSnapshot(state, {
      status: "error",
      activeTurnId: undefined,
      lastError: toMessage(cause, "ACP prompt failed."),
    });

    await offerRuntimeEvent({
      ...makeBaseEvent({
        state,
        rawSource: state.rawSourceSession,
        rawMethod: method,
        rawPayload: {
          message: toMessage(cause, "ACP prompt failed."),
        },
        turnId,
      }),
      type: "runtime.error",
      payload: {
        message: toMessage(cause, "ACP prompt failed."),
        class: "provider_error",
      },
    });

    await offerRuntimeEvent({
      ...makeBaseEvent({
        state,
        rawSource: state.rawSourceSession,
        rawMethod: method,
        rawPayload: {
          message: toMessage(cause, "ACP prompt failed."),
        },
        turnId,
      }),
      type: "turn.completed",
      payload: {
        state: "failed",
        errorMessage: toMessage(cause, "ACP prompt failed."),
      },
    });
  };

  const handleSessionUpdate = async (state: AcpSessionState, update: SessionUpdate) => {
    await logNativeEvent(
      {
        provider: state.provider,
        method: "session/update",
        update,
      },
      state.threadId,
    );

    if (state.replaying) {
      return;
    }

    const turnId = state.activeTurn?.id;
    if (state.activeTurn) {
      state.activeTurn.items.push(update);
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content.type !== "text") {
          return;
        }
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: update.content.text,
            ...(typeof update.contentIndex === "number"
              ? { contentIndex: update.contentIndex }
              : {}),
          },
        });
        return;
      }
      case "agent_thought_chunk": {
        if (update.content.type !== "text") {
          return;
        }
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "content.delta",
          payload: {
            streamKind: "reasoning_text",
            delta: update.content.text,
            ...(typeof update.contentIndex === "number"
              ? { contentIndex: update.contentIndex }
              : {}),
          },
        });
        return;
      }
      case "tool_call": {
        const itemType = classifyItemType(update.kind, update.title);
        const title = describeToolCallTitle(update);
        const detail = summarizeToolCall(update);
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
            itemId: update.toolCallId,
          }),
          type: "item.started",
          payload: {
            itemType,
            status: mapRuntimeItemStatus(update.status),
            ...(title ? { title } : {}),
            ...(detail ? { detail } : {}),
            data: update,
          },
        });
        return;
      }
      case "tool_call_update": {
        const itemType = classifyItemType(update.kind, update.title ?? undefined);
        const status = mapRuntimeItemStatus(update.status);
        const title = describeToolCallTitle(update);
        const detail = summarizeToolCall(update);
        const base = {
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
            itemId: update.toolCallId,
          }),
          payload: {
            itemType,
            ...(status ? { status } : {}),
            ...(title ? { title } : {}),
            ...(detail ? { detail } : {}),
            data: update,
          },
        };
        await offerRuntimeEvent({
          ...base,
          type: "item.updated",
        });
        if (update.status === "completed" || update.status === "failed") {
          await offerRuntimeEvent({
            ...base,
            type: "item.completed",
          });
        }
        return;
      }
      case "plan": {
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "turn.plan.updated",
          payload: {
            plan: update.entries.map((entry) => ({
              step: entry.content,
              status: mapPlanStatus(entry.status),
            })),
          },
        });
        return;
      }
      case "usage_update": {
        const usage = normalizeUsage(update);
        if (!usage) {
          return;
        }
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "thread.token-usage.updated",
          payload: {
            usage,
          },
        });
        return;
      }
      case "current_mode_update": {
        state.currentModeId = update.currentModeId;
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "session.configured",
          payload: {
            config: {
              currentModeId: update.currentModeId,
            },
          },
        });
        return;
      }
      case "config_option_update": {
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "session.configured",
          payload: {
            config: {
              configId: update.configId,
              value: "value" in update ? update.value : undefined,
            },
          },
        });
        return;
      }
      case "available_commands_update": {
        state.availableCommands = update.availableCommands.map((command) => ({ ...command }));
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "session.configured",
          payload: {
            config: {
              availableCommands: update.availableCommands,
            },
          },
        });
        return;
      }
      case "session_info_update": {
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/update",
            rawPayload: update,
            turnId,
          }),
          type: "thread.metadata.updated",
          payload: {
            metadata: update,
          },
        });
        return;
      }
      case "user_message_chunk":
      default:
        return;
    }
  };

  const createClient = (state: AcpSessionState): Client => ({
    sessionUpdate: async (params) => {
      await handleSessionUpdate(state, params.update);
    },
    requestPermission: async (params: RequestPermissionRequest) => {
      await logNativeEvent(
        {
          provider: state.provider,
          method: "requestPermission",
          params,
        },
        state.threadId,
      );

      if (state.stopping) {
        return {
          outcome: {
            outcome: "cancelled",
          },
        };
      }

      const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
      const requestType = classifyRequestType(params.toolCall.kind);
      const detail = summarizeToolCall(params.toolCall);
      const options = params.options
        .map((option) => asObject(option))
        .filter((option): option is Record<string, unknown> => option !== undefined);

      if (state.session.runtimeMode === "full-access") {
        return pickApprovalResponse(options, "acceptForSession");
      }

      return await new Promise<RequestPermissionResponse>((resolve) => {
        state.pendingApprovals.set(requestId, {
          requestId,
          requestType,
          ...(detail ? { detail } : {}),
          ...(params.toolCall.toolCallId ? { toolCallId: params.toolCall.toolCallId } : {}),
          options,
          resolve,
        });

        void offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourcePermission,
            rawMethod: "requestPermission",
            rawPayload: params,
            turnId: state.activeTurn?.id,
            requestId,
            itemId: params.toolCall.toolCallId,
          }),
          type: "request.opened",
          payload: {
            requestType,
            ...(detail ? { detail } : {}),
            args: {
              toolCall: params.toolCall,
              options: params.options,
            },
          },
        });
      });
    },
    readTextFile: async () => {
      throw requestError(config.provider, "fs/readTextFile", "ACP file reads are not enabled.");
    },
    writeTextFile: async () => {
      throw requestError(config.provider, "fs/writeTextFile", "ACP file writes are not enabled.");
    },
  });

  const requireSession = Effect.fn("requireSession")(function* (threadId: ThreadId) {
    const state = sessions.get(threadId);
    if (!state) {
      return yield* Effect.fail(sessionNotFound(config.provider, threadId));
    }
    return state;
  });

  const snapshotThread = (state: AcpSessionState): ProviderThreadSnapshot => ({
    threadId: state.threadId,
    turns: [
      ...state.turns.map((turn) => ({
        id: turn.id,
        items: [...turn.items],
      })),
      ...(state.activeTurn
        ? [
            {
              id: state.activeTurn.id,
              items: [...state.activeTurn.items],
            },
          ]
        : []),
    ],
  });

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
    "startSession",
  )(function* (input: ProviderSessionStartInput) {
    if (input.provider !== undefined && input.provider !== config.provider) {
      return yield* Effect.fail(
        new ProviderAdapterValidationError({
          provider: config.provider,
          operation: "startSession",
          issue: `Expected provider '${config.provider}' but received '${input.provider}'.`,
        }),
      );
    }

    const existing = sessions.get(input.threadId);
    if (existing) {
      yield* Effect.tryPromise({
        try: () => stopSessionInternal(existing, "Replaced by a new session."),
        catch: (cause) =>
          processError(
            config.provider,
            input.threadId,
            toMessage(cause, "Failed to stop existing ACP session."),
            cause,
          ),
      });
    }

    const providerSettings = yield* serverSettingsService.getSettings.pipe(
      Effect.map((settings) => config.readSettings(settings)),
      Effect.mapError((cause) =>
        processError(config.provider, input.threadId, cause.message, cause),
      ),
    );

    const binEntry = yield* Effect.try({
      try: () => resolvePackageBin(config.packageName, config.binName),
      catch: (cause) =>
        processError(
          config.provider,
          input.threadId,
          toMessage(cause, "Failed to resolve ACP server executable."),
          cause,
        ),
    });

    const child = yield* Effect.try({
      try: () =>
        spawn(process.execPath, [binEntry], {
          cwd: input.cwd ?? process.cwd(),
          env: config.configureEnvironment({ ...process.env }, providerSettings),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        }),
      catch: (cause) =>
        processError(
          config.provider,
          input.threadId,
          toMessage(cause, "Failed to spawn ACP server."),
          cause,
        ),
    });

    const createdAt = nowIso();
    const initialModel =
      input.modelSelection?.provider === config.provider ? input.modelSelection.model : undefined;
    const state: AcpSessionState = {
      threadId: input.threadId,
      provider: config.provider,
      child,
      connection: null,
      rawSourceSession: config.rawSourceSession,
      rawSourcePermission: config.rawSourcePermission,
      pendingApprovals: new Map(),
      turns: [],
      sessionId: "",
      session: {
        provider: config.provider,
        status: "connecting",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(initialModel ? { model: initialModel } : {}),
        threadId: input.threadId,
        ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        createdAt,
        updatedAt: createdAt,
      },
      activeTurn: undefined,
      currentModeId: undefined,
      configOptions: [],
      availableModes: [],
      availableCommands: [],
      bootModeId: undefined,
      replaying: false,
      stopping: false,
    };
    sessions.set(input.threadId, state);

    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
    state.connection = new ClientSideConnection(() => createClient(state), stream);

    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (!message) {
        return;
      }

      void (async () => {
        await logNativeEvent(
          {
            provider: state.provider,
            method: "process/stderr",
            message,
          },
          state.threadId,
        );
        await emitRuntimeWarning(state, message);
      })();
    });

    child.once("exit", (code, signal) => {
      if (state.stopping) {
        return;
      }

      state.stopping = true;
      sessions.delete(state.threadId);
      const reason = `ACP server exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`;

      void (async () => {
        for (const pending of state.pendingApprovals.values()) {
          pending.resolve({
            outcome: {
              outcome: "cancelled",
            },
          });
        }
        state.pendingApprovals.clear();

        if (state.activeTurn) {
          await failTurn(state, state.activeTurn.id, "process/exit", new Error(reason));
        } else {
          updateSessionSnapshot(state, {
            status: "error",
            activeTurnId: undefined,
            lastError: reason,
          });
        }

        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "process/exit",
            rawPayload: { code, signal },
          }),
          type: "session.state.changed",
          payload: {
            state: "error",
            reason,
          },
        });

        await emitSessionExit(state, "error", reason);
      })();
    });

    const resumeSessionId = readResumeSessionId(input.resumeCursor);

    const response = yield* Effect.tryPromise({
      try: async () => {
        const connection = state.connection;
        if (!connection) {
          throw new Error("ACP connection was not created.");
        }

        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        });

        let bootstrap: SessionBootstrapResponse | undefined;

        if (resumeSessionId) {
          if (typeof connection.unstable_resumeSession === "function") {
            try {
              bootstrap = await connection.unstable_resumeSession({
                sessionId: resumeSessionId,
              });
              state.sessionId = resumeSessionId;
            } catch {
              bootstrap = undefined;
            }
          }

          if (!bootstrap) {
            state.replaying = true;
            try {
              bootstrap = await connection.loadSession({
                sessionId: resumeSessionId,
              });
              state.sessionId = resumeSessionId;
            } finally {
              state.replaying = false;
            }
          }
        }

        if (!bootstrap) {
          bootstrap = await connection.newSession({
            ...(input.cwd ? { cwd: input.cwd } : {}),
            mcpServers: [],
          });
          state.sessionId = bootstrap.sessionId;
        }

        if (
          !state.sessionId &&
          "sessionId" in bootstrap &&
          typeof bootstrap.sessionId === "string"
        ) {
          state.sessionId = bootstrap.sessionId;
        }
        if (!state.sessionId) {
          throw new Error("ACP session did not return a session ID.");
        }

        applyBootstrapState(state, bootstrap);
        updateSessionSnapshot(state, {
          status: "ready",
          ...(bootstrap.models?.currentModelId ? { model: bootstrap.models.currentModelId } : {}),
          resumeCursor: buildResumeCursor(state.sessionId),
          lastError: undefined,
        });

        return bootstrap;
      },
      catch: (cause) =>
        processError(
          config.provider,
          input.threadId,
          toMessage(cause, "Failed to initialize ACP session."),
          cause,
        ),
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          state.stopping = true;
          sessions.delete(state.threadId);
          if (!child.killed) {
            child.kill();
          }
        }).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );

    yield* Effect.tryPromise({
      try: async () => {
        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/start",
            rawPayload: response,
          }),
          type: "session.started",
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
        });

        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/start",
            rawPayload: response,
          }),
          type: "session.configured",
          payload: {
            config: {
              ...(state.session.model ? { model: state.session.model } : {}),
              ...(state.currentModeId ? { currentModeId: state.currentModeId } : {}),
              ...(state.availableModes.length > 0 ? { availableModes: state.availableModes } : {}),
              ...(state.configOptions.length > 0 ? { configOptions: state.configOptions } : {}),
            },
          },
        });

        await offerRuntimeEvent({
          ...makeBaseEvent({
            state,
            rawSource: state.rawSourceSession,
            rawMethod: "session/start",
            rawPayload: response,
          }),
          type: "session.state.changed",
          payload: {
            state: "ready",
          },
        });
      },
      catch: (cause) =>
        processError(
          config.provider,
          input.threadId,
          toMessage(cause, "Failed to emit ACP startup events."),
          cause,
        ),
    });

    return {
      ...state.session,
    };
  });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn("sendTurn")(
    function* (input: ProviderSendTurnInput) {
      const state = yield* requireSession(input.threadId);
      if (state.activeTurn) {
        return yield* Effect.fail(
          new ProviderAdapterValidationError({
            provider: config.provider,
            operation: "sendTurn",
            issue: "Session already has an active turn.",
          }),
        );
      }

      const connection = state.connection;
      if (!connection || !state.sessionId) {
        return yield* Effect.fail(
          processError(config.provider, input.threadId, "ACP session connection is unavailable."),
        );
      }

      const prompt = yield* buildPromptBlocks(input, {
        fileSystem,
        attachmentsDir: serverConfig.attachmentsDir,
        provider: config.provider,
      });

      const modelSelection =
        input.modelSelection?.provider === config.provider ? input.modelSelection : undefined;
      if (modelSelection?.model) {
        yield* Effect.tryPromise({
          try: () =>
            connection.unstable_setSessionModel({
              sessionId: state.sessionId,
              modelId: modelSelection.model,
            }),
          catch: (cause) =>
            requestError(
              config.provider,
              "session/setModel",
              toMessage(cause, "Failed to switch ACP model."),
              cause,
            ),
        });

        if (config.applyModelOptions) {
          yield* Effect.tryPromise({
            try: () =>
              config.applyModelOptions?.({
                connection,
                sessionId: state.sessionId,
                configOptions: state.configOptions,
                modelSelection,
              }) ?? Promise.resolve(),
            catch: (cause) =>
              requestError(
                config.provider,
                "session/setConfigOption",
                toMessage(cause, "Failed to configure ACP model options."),
                cause,
              ),
          });
        }

        updateSessionSnapshot(state, {
          model: modelSelection.model,
        });
      }

      if (input.interactionMode) {
        const modeId =
          findModeId(state.availableModes, input.interactionMode) ??
          state.bootModeId ??
          state.currentModeId;
        if (modeId && modeId !== state.currentModeId) {
          yield* Effect.tryPromise({
            try: () =>
              connection.setSessionMode({
                sessionId: state.sessionId,
                modeId,
              }),
            catch: (cause) =>
              requestError(
                config.provider,
                "session/setMode",
                toMessage(cause, "Failed to switch ACP session mode."),
                cause,
              ),
          });
          state.currentModeId = modeId;
        }
      }

      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      state.activeTurn = {
        id: turnId,
        items: [],
      };
      updateSessionSnapshot(state, {
        status: "running",
        activeTurnId: turnId,
      });

      yield* Effect.tryPromise({
        try: () =>
          offerRuntimeEvent({
            ...makeBaseEvent({
              state,
              rawSource: state.rawSourceSession,
              rawMethod: "session/prompt",
              rawPayload: { prompt },
              turnId,
            }),
            type: "turn.started",
            payload: {
              ...(state.session.model ? { model: state.session.model } : {}),
            },
          }),
        catch: (cause) =>
          requestError(
            config.provider,
            "session/prompt",
            toMessage(cause, "Failed to emit ACP turn-start event."),
            cause,
          ),
      });

      void connection
        .prompt({
          sessionId: state.sessionId,
          prompt,
        })
        .then((promptResponse) => completeTurn(state, turnId, promptResponse))
        .catch((cause) => failTurn(state, turnId, "session/prompt", cause));

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: buildResumeCursor(state.sessionId),
      };
    },
  );

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    _turnId,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap((state) => {
        if (!state.connection || !state.sessionId) {
          return Effect.fail(
            processError(config.provider, threadId, "ACP session connection is unavailable."),
          );
        }
        return Effect.tryPromise({
          try: () =>
            state.connection!.cancel({
              sessionId: state.sessionId,
            }),
          catch: (cause) =>
            requestError(
              config.provider,
              "session/cancel",
              toMessage(cause, "Failed to cancel ACP turn."),
              cause,
            ),
        });
      }),
    );

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] =
    Effect.fn("respondToRequest")(function* (threadId, requestId, decision) {
      const state = yield* requireSession(threadId);
      const pending = state.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* Effect.fail(
          requestError(
            config.provider,
            "request/respond",
            `Unknown pending approval request '${requestId}'.`,
          ),
        );
      }

      state.pendingApprovals.delete(requestId);
      const response = pickApprovalResponse(pending.options, decision);
      pending.resolve(response);

      yield* Effect.tryPromise({
        try: () =>
          offerRuntimeEvent({
            ...makeBaseEvent({
              state,
              rawSource: state.rawSourcePermission,
              rawMethod: "requestPermission/decision",
              rawPayload: {
                decision,
                response,
              },
              turnId: state.activeTurn?.id,
              requestId,
              itemId: pending.toolCallId,
            }),
            type: "request.resolved",
            payload: {
              requestType: pending.requestType,
              decision,
              resolution: response,
            },
          }),
        catch: (cause) =>
          requestError(
            config.provider,
            "request/respond",
            toMessage(cause, "Failed to emit ACP approval resolution."),
            cause,
          ),
      });
    });

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    _threadId,
    _requestId,
    _answers: ProviderUserInputAnswers,
  ) =>
    Effect.fail(
      requestError(
        config.provider,
        "userInput/respond",
        "Structured user input is not exposed by the ACP adapters yet.",
      ),
    );

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((state) =>
        Effect.tryPromise({
          try: () => stopSessionInternal(state, "Session stopped by user."),
          catch: (cause) =>
            processError(
              config.provider,
              threadId,
              toMessage(cause, "Failed to stop ACP session."),
              cause,
            ),
        }),
      ),
    );

  const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
    Effect.sync(() =>
      Array.from(sessions.values())
        .filter((state) => !state.stopping)
        .map((state) => ({ ...state.session })),
    );

  const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const state = sessions.get(threadId);
      return state !== undefined && !state.stopping;
    });

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    requireSession(threadId).pipe(Effect.map(snapshotThread));

  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = Effect.fn(
    "rollbackThread",
  )(function* (threadId, numTurns) {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return yield* Effect.fail(
        new ProviderAdapterValidationError({
          provider: config.provider,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        }),
      );
    }

    const state = yield* requireSession(threadId);
    const nextLength = Math.max(0, state.turns.length - numTurns);
    state.turns.splice(nextLength);
    return snapshotThread(state);
  });

  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.tryPromise({
      try: async () => {
        for (const state of [...sessions.values()]) {
          await stopSessionInternal(state, "Adapter shutdown.");
        }
      },
      catch: (cause) =>
        processError(
          config.provider,
          ThreadId.makeUnsafe("adapter-shutdown"),
          toMessage(cause, "Failed to stop ACP sessions."),
          cause,
        ),
    }).pipe(Effect.asVoid);

  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      [...sessions.values()],
      (state) =>
        Effect.tryPromise({
          try: () => stopSessionInternal(state, "Adapter finalizer."),
          catch: () => Promise.resolve(),
        }).pipe(Effect.asVoid),
      { discard: true },
    ).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue))),
  );

  return {
    provider: config.provider,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    readThread,
    rollbackThread,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});

export const CodexAcpProviderConfig: AcpProviderConfig = {
  provider: "codex",
  packageName: "@zed-industries/codex-acp",
  binName: "codex-acp",
  rawSourceSession: "codex.acp.session-update",
  rawSourcePermission: "codex.acp.permission",
  readSettings: (settings) => settings.providers.codex,
  configureEnvironment: (env, settings) => {
    const normalized = normalizePathEnv(env, settings.binaryPath);
    return {
      ...normalized,
      ...(settings.homePath ? { CODEX_HOME: settings.homePath } : {}),
    };
  },
  applyModelOptions: applyCodexModelOptions,
};

export const ClaudeAcpProviderConfig: AcpProviderConfig = {
  provider: "claudeAgent",
  packageName: "@agentclientprotocol/claude-agent-acp",
  binName: "claude-agent-acp",
  rawSourceSession: "claude.acp.session-update",
  rawSourcePermission: "claude.acp.permission",
  readSettings: (settings) => settings.providers.claudeAgent,
  configureEnvironment: (env, settings) => ({
    ...normalizePathEnv(env, settings.binaryPath),
    CLAUDE_CODE_EXECUTABLE: settings.binaryPath,
  }),
  applyModelOptions: applyClaudeModelOptions,
};

export const makeAcpProviderAdapterLayer = makeAcpProviderAdapter;
