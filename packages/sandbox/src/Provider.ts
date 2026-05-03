import type {
  ExecutionEnvironmentDescriptor,
  SandboxDescriptor,
  SandboxId,
  SandboxProviderKind,
  SandboxResourceSpec,
  SandboxRuntimeProviderConfig,
  SandboxServiceDescriptor,
  SandboxServiceRequest,
  SandboxSnapshotDescriptor,
  SandboxWorktreeDescriptor,
} from "@t3tools/contracts";
import { Effect } from "effect";

import type { SandboxError } from "./Errors.ts";
import { makeSandboxError } from "./Errors.ts";

export interface SandboxMaterializeTaskRuntimeInput {
  readonly taskId: string;
  readonly workSessionId: string;
  readonly title: string;
  readonly initialPrompt: string;
  readonly project: {
    readonly repoName: string;
    readonly workspaceRoot: string;
    readonly defaultBranch: string;
    readonly projectKey?: string;
  };
  readonly resources?: SandboxResourceSpec;
  readonly environment?: string;
  readonly providerConfig?: SandboxRuntimeProviderConfig;
  readonly services?: ReadonlyArray<SandboxServiceRequest>;
  readonly idempotencyKey: string;
  readonly snapshot?: SandboxSnapshotDescriptor;
  readonly startCodingAgent: boolean;
}

export interface SandboxReconnectInput {
  readonly sandboxId: SandboxId;
  readonly taskId: string;
  readonly workSessionId: string;
}

export interface SandboxStatusInput {
  readonly sandboxId: SandboxId;
}

export interface SandboxArchiveInput {
  readonly sandboxId: SandboxId;
  readonly reason?: string;
}

export interface SandboxTerminateInput {
  readonly sandboxId: SandboxId;
  readonly reason?: string;
}

export interface SandboxMaterializationResult {
  readonly sandbox: SandboxDescriptor;
  readonly environment: ExecutionEnvironmentDescriptor;
  readonly services: ReadonlyArray<SandboxServiceDescriptor>;
  readonly worktree?: SandboxWorktreeDescriptor;
}

export interface SandboxReconnectResult {
  readonly sandbox: SandboxDescriptor;
  readonly environment: ExecutionEnvironmentDescriptor;
  readonly services: ReadonlyArray<SandboxServiceDescriptor>;
}

export interface SandboxArchiveResult {
  readonly sandbox: SandboxDescriptor;
  readonly archivedAt: string;
}

export interface SandboxTerminateResult {
  readonly sandboxId: SandboxId;
  readonly terminatedAt: string;
}

export interface SandboxProvider {
  readonly providerKind: SandboxProviderKind;
  readonly materializeTaskRuntime: (
    input: SandboxMaterializeTaskRuntimeInput,
  ) => Effect.Effect<SandboxMaterializationResult, SandboxError>;
  readonly reconnect: (
    input: SandboxReconnectInput,
  ) => Effect.Effect<SandboxReconnectResult, SandboxError>;
  readonly getStatus: (input: SandboxStatusInput) => Effect.Effect<SandboxDescriptor, SandboxError>;
  readonly archive: (
    input: SandboxArchiveInput,
  ) => Effect.Effect<SandboxArchiveResult, SandboxError>;
  readonly terminate: (
    input: SandboxTerminateInput,
  ) => Effect.Effect<SandboxTerminateResult, SandboxError>;
}

export interface SandboxProviderRegistry {
  readonly get: (providerKind: SandboxProviderKind) => Effect.Effect<SandboxProvider, SandboxError>;
}

export function makeSandboxProviderRegistry(
  providers: Iterable<SandboxProvider>,
): SandboxProviderRegistry {
  const byKind = new Map<SandboxProviderKind, SandboxProvider>();
  for (const provider of providers) {
    byKind.set(provider.providerKind, provider);
  }

  return {
    get(providerKind) {
      const provider = byKind.get(providerKind);
      if (provider) {
        return Effect.succeed(provider);
      }

      return Effect.fail(
        makeSandboxError({
          kind: "invalid_request",
          operation: "materialize",
          message: `Sandbox provider is not registered: ${providerKind}`,
          retryable: false,
        }),
      );
    },
  };
}
