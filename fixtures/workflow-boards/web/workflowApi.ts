// Plugin-local workflow data layer.
//
// The board component tree is prop-drilled with an `api: WorkflowApi` facade
// (the shape that used to be `readEnvironmentApi(env).workflow` on the host).
// The host no longer carries any workflow client state — it was moved into this
// plugin — so we re-back the SAME facade with the plugin RPC bridge: every method
// maps to `rpc.call("workflow.<name>", input)`, and `subscribeBoard` folds the
// `workflow.subscribeBoard` stream. The server plugin exposes all of these
// methods (see ../contracts/workflow.ts `WORKFLOW_WS_METHODS`), so the mapping is
// 1:1 and the board UI keeps working unchanged.

import {
  AsyncResult,
  getAppAtomRegistry,
  getConnectionAtomRuntime,
  type PluginWebRpc,
} from "@t3tools/plugin-sdk-web";
import type {
  EnvironmentApi as HostEnvironmentApi,
  MessageId,
  ProjectId
} from "@t3tools/contracts";
import { useMemo } from "react";

import { WORKFLOW_WS_METHODS } from "../contracts/workflow.ts";
import type {
  AgentSelection,
  BoardId,
  BoardListEntry,
  BoardSnapshot,
  BoardStreamItem,
  LaneKey,
  StepRunId,
  TicketAttachment,
  TicketDiff,
  TicketId,
  WorkflowBoardDigest,
  WorkflowBoardMetrics,
  WorkflowBoardVersionSummary,
  WorkflowCreateBoardInput,
  WorkflowCreateWorkflowBoardInput,
  WorkflowCreateWorkflowBoardResult,
  WorkflowDefinitionEncoded,
  WorkflowDryRunResult,
  WorkflowDryRunScenario,
  WorkflowGenerateWorkflowDraftInput,
  WorkflowGenerateWorkflowDraftResult,
  WorkflowGetBoardDefinitionResult,
  WorkflowGetBoardProposalResult,
  WorkflowGetBoardVersionResult,
  WorkflowImportBoardInput,
  WorkflowImportBoardResult,
  WorkflowIntakeResult,
  WorkflowListBoardProposalsResult,
  WorkflowListBoardTemplatesResult,
  WorkflowProposeBoardImprovementInput,
  WorkflowProposeBoardImprovementResult,
  WorkflowRenameBoardInput,
  WorkflowResolveBoardProposalInput,
  WorkflowResolveBoardProposalResult,
  WorkflowRevertBoardProposalResult,
  WorkflowSaveBoardDefinitionInput,
  WorkflowSaveBoardDefinitionResult,
  WorkflowTicketArtifactsResult,
  WorkflowTicketDetailView,
  WorkflowWebhookConfig,
  WorkSourceProviderName,
} from "../contracts/workflow.ts";
import type {
  CreateOutboundConnectionInput,
  OutboundConnectionView,
} from "../contracts/outbound.ts";
import type {
  ImportWorkItemsResult,
  ListImportableWorkItemsResult,
  WorkSourceConnectionView,
} from "../contracts/workSource.ts";

/**
 * The board UI facade. Extracted from the host's former
 * `EnvironmentApi["workflow"]` (packages/contracts ipc.ts) so the prop-drilled
 * board component tree keeps its `api: WorkflowApi` typing without depending on
 * any host workflow types.
 */
export interface WorkflowApi {
  listBoards: (input: { readonly projectId: ProjectId }) => Promise<ReadonlyArray<BoardListEntry>>;
  createBoard: (
    input: WorkflowCreateBoardInput,
  ) => Promise<{ readonly boardId: BoardId; readonly snapshot: BoardSnapshot }>;
  importBoard: (input: WorkflowImportBoardInput) => Promise<WorkflowImportBoardResult>;
  createWorkflowBoard: (
    input: WorkflowCreateWorkflowBoardInput,
  ) => Promise<WorkflowCreateWorkflowBoardResult>;
  generateWorkflowDraft: (
    input: WorkflowGenerateWorkflowDraftInput,
  ) => Promise<WorkflowGenerateWorkflowDraftResult>;
  listBoardTemplates: (input: {}) => Promise<WorkflowListBoardTemplatesResult>;
  deleteBoard: (input: { readonly boardId: BoardId }) => Promise<void>;
  renameBoard: (input: WorkflowRenameBoardInput) => Promise<void>;
  getBoard: (input: { readonly boardId: BoardId }) => Promise<BoardSnapshot>;
  getBoardDefinition: (input: {
    readonly boardId: BoardId;
  }) => Promise<WorkflowGetBoardDefinitionResult>;
  saveBoardDefinition: (
    input: WorkflowSaveBoardDefinitionInput,
  ) => Promise<WorkflowSaveBoardDefinitionResult>;
  listBoardVersions: (input: {
    readonly boardId: BoardId;
  }) => Promise<ReadonlyArray<WorkflowBoardVersionSummary>>;
  getBoardVersion: (input: {
    readonly boardId: BoardId;
    readonly versionId: number;
  }) => Promise<WorkflowGetBoardVersionResult>;
  subscribeBoard: (
    input: { readonly boardId: BoardId },
    callback: (event: BoardStreamItem) => void,
    options?: {
      onResubscribe?: () => void;
    },
  ) => () => void;
  createTicket: (input: {
    readonly boardId: BoardId;
    readonly title: string;
    readonly description?: string | undefined;
    readonly initialLane: LaneKey;
    readonly dependsOn?: ReadonlyArray<TicketId> | undefined;
    readonly tokenBudget?: number | undefined;
  }) => Promise<{ readonly ticketId: TicketId }>;
  editTicket: (input: {
    readonly ticketId: TicketId;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly dependsOn?: ReadonlyArray<TicketId> | undefined;
    readonly tokenBudget?: number | null | undefined;
  }) => Promise<void>;
  moveTicket: (input: { readonly ticketId: TicketId; readonly toLane: LaneKey }) => Promise<void>;
  runLane: (input: { readonly ticketId: TicketId }) => Promise<void>;
  resolveApproval: (input: {
    readonly stepRunId: StepRunId;
    readonly approved: boolean;
  }) => Promise<void>;
  answerTicketStep: (input: {
    readonly stepRunId: StepRunId;
    readonly text?: string | undefined;
    readonly attachments?: ReadonlyArray<TicketAttachment> | undefined;
  }) => Promise<void>;
  postTicketMessage: (input: {
    readonly ticketId: TicketId;
    readonly text?: string | undefined;
    readonly attachments?: ReadonlyArray<TicketAttachment> | undefined;
  }) => Promise<void>;
  editTicketMessage: (input: {
    readonly ticketId: TicketId;
    readonly messageId: MessageId;
    readonly body: string;
  }) => Promise<void>;
  setProjectScriptTrust: (input: {
    readonly projectId: ProjectId;
    readonly trusted: boolean;
  }) => Promise<void>;
  cancelStep: (input: { readonly stepRunId: StepRunId }) => Promise<void>;
  getTicketDetail: (input: { readonly ticketId: TicketId }) => Promise<WorkflowTicketDetailView>;
  getTicketDiff: (input: { readonly ticketId: TicketId }) => Promise<TicketDiff>;
  intakeTickets: (input: {
    readonly boardId: BoardId;
    readonly braindump: string;
    readonly agent: AgentSelection;
  }) => Promise<WorkflowIntakeResult>;
  listTicketArtifacts: (input: {
    readonly ticketId: TicketId;
  }) => Promise<WorkflowTicketArtifactsResult>;
  getWebhookConfig: (input: {
    readonly boardId: BoardId;
    readonly rotate?: boolean | undefined;
  }) => Promise<WorkflowWebhookConfig>;
  getBoardDigest: (input: {
    readonly boardId: BoardId;
    readonly windowHours?: number | undefined;
  }) => Promise<WorkflowBoardDigest>;
  getBoardMetrics: (input: {
    readonly boardId: BoardId;
    readonly windowDays?: number | undefined;
  }) => Promise<WorkflowBoardMetrics>;
  dryRunBoard: (input: {
    readonly definition: WorkflowDefinitionEncoded;
    readonly startLane: LaneKey;
    readonly scenario: WorkflowDryRunScenario;
  }) => Promise<WorkflowDryRunResult>;
  listWorkSourceConnections: (
    input: Record<string, never>,
  ) => Promise<ReadonlyArray<WorkSourceConnectionView>>;
  createWorkSourceConnection: (input: {
    readonly provider: WorkSourceProviderName;
    readonly displayName: string;
    readonly token: string;
    readonly authMode?: "pat" | "basic" | "bearer";
    readonly baseUrl?: string;
    readonly email?: string;
  }) => Promise<WorkSourceConnectionView>;
  deleteWorkSourceConnection: (input: { readonly connectionRef: string }) => Promise<void>;
  listOutboundConnections: (
    input: Record<string, never>,
  ) => Promise<{ readonly connections: ReadonlyArray<OutboundConnectionView> }>;
  createOutboundConnection: (
    input: CreateOutboundConnectionInput,
  ) => Promise<{ readonly connection: OutboundConnectionView }>;
  deleteOutboundConnection: (input: { readonly connectionRef: string }) => Promise<void>;
  proposeBoardImprovement: (
    input: WorkflowProposeBoardImprovementInput,
  ) => Promise<WorkflowProposeBoardImprovementResult>;
  listBoardProposals: (input: {
    readonly boardId: BoardId;
  }) => Promise<WorkflowListBoardProposalsResult>;
  getBoardProposal: (input: {
    readonly proposalId: string;
  }) => Promise<WorkflowGetBoardProposalResult>;
  resolveBoardProposal: (
    input: WorkflowResolveBoardProposalInput,
  ) => Promise<WorkflowResolveBoardProposalResult>;
  revertBoardProposal: (input: {
    readonly proposalId: string;
  }) => Promise<WorkflowRevertBoardProposalResult>;
  listImportableWorkItems: (input: {
    readonly boardId: BoardId;
  }) => Promise<ListImportableWorkItemsResult>;
  importWorkItems: (input: {
    readonly boardId: BoardId;
    readonly sourceId: string;
    readonly externalIds: ReadonlyArray<string>;
    readonly destinationLane?: LaneKey;
  }) => Promise<ImportWorkItemsResult>;
}

export interface WorkflowEnvironmentApi {
  readonly workflow: WorkflowApi;
  readonly orchestration?:
    | Pick<HostEnvironmentApi["orchestration"], "subscribeThread">
    | undefined;
  // The worktree terminal API (post-#2978) has no `attachHistory`; `attach` with
  // `restartIfNotRunning: false` is the read-existing-output equivalent.
  readonly terminal?: Pick<HostEnvironmentApi["terminal"], "attach"> | undefined;
}

/**
 * Raw board subscription: mount an atom over the `workflow.subscribeBoard` stream
 * on the host's connection runtime and forward each emitted `BoardStreamItem` to
 * the callback. Mirrors the host's former `subscribeBoardRaw` (registry.mount +
 * registry.subscribe on the raw stream atom). Returns an unsubscribe that both
 * detaches the listener and unmounts the atom so the stream fiber is interrupted.
 */
function subscribeBoardRaw(
  rpc: PluginWebRpc,
  input: { readonly boardId: BoardId },
  callback: (event: BoardStreamItem) => void,
): () => void {
  const runtime = getConnectionAtomRuntime();
  const registry = getAppAtomRegistry();
  const stream = rpc.subscribe(WORKFLOW_WS_METHODS.subscribeBoard, input);
  // `as never`: the SDK types the subscription's Effect context (R) as `unknown`,
  // wider than the runtime context, so `runtime.atom` rejects it. Runtime-safe — the
  // stream is self-contained and this is the host's own connection runtime.
  const atom = runtime.atom(stream as never);
  const unmount = registry.mount(atom);
  const unsubscribe = registry.subscribe(atom, (result) => {
    if (AsyncResult.isSuccess(result)) {
      callback(result.value as BoardStreamItem);
    }
  });
  return () => {
    unsubscribe();
    unmount();
  };
}

/**
 * Build a `WorkflowApi` facade backed by the plugin RPC bridge. Every unary
 * method resolves `rpc.call("workflow.<name>", input)`; `subscribeBoard` folds
 * the live board stream.
 */
export function createWorkflowApi(rpc: PluginWebRpc): WorkflowApi {
  const call = <T>(method: string, input: unknown): Promise<T> => rpc.call(method, input) as Promise<T>;
  const M = WORKFLOW_WS_METHODS;
  return {
    listBoards: (input) => call(M.listBoards, input),
    createBoard: (input) => call(M.createBoard, input),
    importBoard: (input) => call(M.importBoard, input),
    createWorkflowBoard: (input) => call(M.createWorkflowBoard, input),
    generateWorkflowDraft: (input) => call(M.generateWorkflowDraft, input),
    listBoardTemplates: (input) => call(M.listBoardTemplates, input),
    deleteBoard: (input) => call(M.deleteBoard, input),
    renameBoard: (input) => call(M.renameBoard, input),
    getBoard: (input) => call(M.getBoard, input),
    getBoardDefinition: (input) => call(M.getBoardDefinition, input),
    saveBoardDefinition: (input) => call(M.saveBoardDefinition, input),
    listBoardVersions: (input) => call(M.listBoardVersions, input),
    getBoardVersion: (input) => call(M.getBoardVersion, input),
    subscribeBoard: (input, callback) => subscribeBoardRaw(rpc, input, callback),
    createTicket: (input) => call(M.createTicket, input),
    editTicket: (input) => call(M.editTicket, input),
    moveTicket: (input) => call(M.moveTicket, input),
    runLane: (input) => call(M.runLane, input),
    resolveApproval: (input) => call(M.resolveApproval, input),
    answerTicketStep: (input) => call(M.answerTicketStep, input),
    postTicketMessage: (input) => call(M.postTicketMessage, input),
    editTicketMessage: (input) => call(M.editTicketMessage, input),
    setProjectScriptTrust: (input) => call(M.setProjectScriptTrust, input),
    cancelStep: (input) => call(M.cancelStep, input),
    getTicketDetail: (input) => call(M.getTicketDetail, input),
    getTicketDiff: (input) => call(M.getTicketDiff, input),
    intakeTickets: (input) => call(M.intakeTickets, input),
    listTicketArtifacts: (input) => call(M.listTicketArtifacts, input),
    getWebhookConfig: (input) => call(M.getWebhookConfig, input),
    getBoardDigest: (input) => call(M.getBoardDigest, input),
    getBoardMetrics: (input) => call(M.getBoardMetrics, input),
    dryRunBoard: (input) => call(M.dryRunBoard, input),
    listWorkSourceConnections: (input) => call(M.listWorkSourceConnections, input),
    createWorkSourceConnection: (input) => call(M.createWorkSourceConnection, input),
    deleteWorkSourceConnection: (input) => call(M.deleteWorkSourceConnection, input),
    listOutboundConnections: (input) => call(M.listOutboundConnections, input),
    createOutboundConnection: (input) => call(M.createOutboundConnection, input),
    deleteOutboundConnection: (input) => call(M.deleteOutboundConnection, input),
    proposeBoardImprovement: (input) => call(M.proposeBoardImprovement, input),
    listBoardProposals: (input) => call(M.listBoardProposals, input),
    getBoardProposal: (input) => call(M.getBoardProposal, input),
    resolveBoardProposal: (input) => call(M.resolveBoardProposal, input),
    revertBoardProposal: (input) => call(M.revertBoardProposal, input),
    listImportableWorkItems: (input) => call(M.listImportableWorkItems, input),
    importWorkItems: (input) => call(M.importWorkItems, input),
  };
}

export function useWorkflowApi(rpc: PluginWebRpc): WorkflowApi {
  return useMemo(() => createWorkflowApi(rpc), [rpc]);
}
