import {
  EnvironmentId,
  SandboxId,
  type ExecutionEnvironmentDescriptor,
  type SandboxDescriptor,
  type SandboxProviderKind,
  type SandboxResourceSpec,
  type SandboxServiceDescriptor,
} from "@t3tools/contracts";
import { Effect } from "effect";

import type { SandboxError } from "./Errors.ts";
import { makeSandboxError } from "./Errors.ts";
import { buildSandboxName, buildTaskBranchName } from "./Names.ts";
import type {
  SandboxArchiveInput,
  SandboxMaterializationResult,
  SandboxMaterializeTaskRuntimeInput,
  SandboxProvider,
  SandboxReconnectInput,
  SandboxStatusInput,
  SandboxTerminateInput,
} from "./Provider.ts";
import { normalizeSandboxServiceRequests } from "./Services.ts";

export interface FakeSandboxProviderOptions {
  readonly providerKind?: SandboxProviderKind;
  readonly now?: () => Date;
  readonly failMaterialize?: boolean;
}

function makeEnvironmentDescriptor(input: {
  readonly sandboxId: SandboxId;
  readonly title: string;
}): ExecutionEnvironmentDescriptor {
  return {
    environmentId: EnvironmentId.make(`fake-env-${input.sandboxId}`),
    label: input.title,
    platform: {
      os: "linux",
      arch: "x64",
    },
    serverVersion: "fake",
    capabilities: {
      repositoryIdentity: true,
    },
  };
}

function makeServiceDescriptors(
  input: SandboxMaterializeTaskRuntimeInput,
): ReadonlyArray<SandboxServiceDescriptor> {
  return normalizeSandboxServiceRequests(input.services).map((request) => {
    const descriptor: {
      serviceId: SandboxServiceDescriptor["serviceId"];
      kind: SandboxServiceDescriptor["kind"];
      status: SandboxServiceDescriptor["status"];
      label?: string;
      metadata?: Record<string, unknown>;
    } = {
      serviceId: request.serviceId,
      kind: request.kind,
      status: "ready",
    };
    if (request.label !== undefined) {
      descriptor.label = request.label;
    }
    if (request.metadata !== undefined) {
      descriptor.metadata = request.metadata;
    }
    return descriptor;
  });
}

function replaceSandbox(
  result: SandboxMaterializationResult,
  sandbox: SandboxDescriptor,
): SandboxMaterializationResult {
  return {
    ...result,
    sandbox,
    services: sandbox.services,
    ...(sandbox.worktree !== undefined ? { worktree: sandbox.worktree } : {}),
  };
}

export function makeFakeSandboxProvider(options: FakeSandboxProviderOptions = {}): SandboxProvider {
  const providerKind = options.providerKind ?? "local";
  const now = options.now ?? (() => new Date());
  let nextId = 1;
  const sandboxById = new Map<string, SandboxMaterializationResult>();
  const sandboxIdByIdempotencyKey = new Map<string, string>();

  const findResult = (
    sandboxId: SandboxId,
    operation: "reconnect" | "status" | "archive" | "terminate",
  ): Effect.Effect<SandboxMaterializationResult, SandboxError> => {
    const result = sandboxById.get(String(sandboxId));
    if (result) {
      return Effect.succeed(result);
    }

    return Effect.fail(
      makeSandboxError({
        kind: "invalid_request",
        operation,
        message: `Fake Sandbox not found: ${sandboxId}`,
        retryable: false,
        providerKind,
        sandboxId,
      }),
    );
  };

  const provider: SandboxProvider = {
    providerKind,
    materializeTaskRuntime(input) {
      return Effect.suspend(() => {
        if (options.failMaterialize) {
          return Effect.fail(
            makeSandboxError({
              kind: "provider_unavailable",
              operation: "materialize",
              message: "Fake Sandbox materialization failed.",
              providerKind,
            }),
          );
        }

        const existingId = sandboxIdByIdempotencyKey.get(input.idempotencyKey);
        const existing = existingId ? sandboxById.get(existingId) : undefined;
        if (existing) {
          return Effect.succeed(existing);
        }

        const sandboxId = SandboxId.make(`fake-sandbox-${nextId}`);
        nextId += 1;
        const timestamp = now().toISOString();
        const branch = buildTaskBranchName({ taskId: input.taskId, title: input.title });
        const services = makeServiceDescriptors(input);
        const resources: SandboxResourceSpec = input.resources ?? {};
        const worktree = {
          workspaceRoot: input.project.workspaceRoot,
          worktreePath: `${input.project.workspaceRoot}/.t3/fake/${sandboxId}`,
          branch,
          baseBranch: input.project.defaultBranch,
        };
        const sandbox: SandboxDescriptor = {
          sandboxId,
          providerKind,
          providerRef: {
            providerKind,
            externalId: sandboxId,
            name: buildSandboxName({
              providerKind,
              taskId: input.taskId,
              title: input.title,
            }),
          },
          status: "ready",
          taskId: input.taskId,
          workSessionId: input.workSessionId,
          project: {
            repoName: input.project.repoName,
            workspaceRoot: input.project.workspaceRoot,
            defaultBranch: input.project.defaultBranch,
            ...(input.project.projectKey !== undefined
              ? { projectKey: input.project.projectKey }
              : {}),
          },
          resources,
          worktree,
          ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
          services,
          artifacts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const environment = makeEnvironmentDescriptor({ sandboxId, title: input.title });
        const result: SandboxMaterializationResult = {
          sandbox,
          environment,
          services,
          worktree,
        };

        sandboxById.set(String(sandboxId), result);
        sandboxIdByIdempotencyKey.set(input.idempotencyKey, String(sandboxId));
        return Effect.succeed(result);
      });
    },
    reconnect(input: SandboxReconnectInput) {
      return findResult(input.sandboxId, "reconnect").pipe(
        Effect.map((result) => ({
          sandbox: result.sandbox,
          environment: result.environment,
          services: result.services,
        })),
      );
    },
    getStatus(input: SandboxStatusInput) {
      return findResult(input.sandboxId, "status").pipe(Effect.map((result) => result.sandbox));
    },
    archive(input: SandboxArchiveInput) {
      return findResult(input.sandboxId, "archive").pipe(
        Effect.map((result) => {
          const archivedAt = now().toISOString();
          const sandbox: SandboxDescriptor = {
            ...result.sandbox,
            status: "archived",
            updatedAt: archivedAt,
          };
          sandboxById.set(String(input.sandboxId), replaceSandbox(result, sandbox));
          return { sandbox, archivedAt };
        }),
      );
    },
    terminate(input: SandboxTerminateInput) {
      return findResult(input.sandboxId, "terminate").pipe(
        Effect.map((result) => {
          const terminatedAt = now().toISOString();
          const sandbox: SandboxDescriptor = {
            ...result.sandbox,
            status: "terminated",
            updatedAt: terminatedAt,
          };
          sandboxById.set(String(input.sandboxId), replaceSandbox(result, sandbox));
          return { sandboxId: input.sandboxId, terminatedAt };
        }),
      );
    },
  };

  return provider;
}
