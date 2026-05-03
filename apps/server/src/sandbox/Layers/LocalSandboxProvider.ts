import {
  SandboxId,
  type ExecutionEnvironmentDescriptor,
  type SandboxDescriptor,
  type SandboxResourceSpec,
  type SandboxServiceDescriptor,
} from "@t3tools/contracts";
import {
  buildSandboxName,
  buildTaskBranchName,
  normalizeSandboxServiceRequests,
  sandboxErrorFromUnknown,
  type SandboxMaterializationResult,
  type SandboxMaterializeTaskRuntimeInput,
  type SandboxProvider,
} from "@t3tools/sandbox";
import { Effect } from "effect";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";

function buildServiceDescriptors(
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

export const makeLocalSandboxProvider = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const serverEnvironment = yield* ServerEnvironment;

  const provider: SandboxProvider = {
    providerKind: "local",
    materializeTaskRuntime(input) {
      return Effect.gen(function* () {
        const environment: ExecutionEnvironmentDescriptor = yield* serverEnvironment.getDescriptor;
        const branch = buildTaskBranchName({ taskId: input.taskId, title: input.title });
        const worktreeResult = yield* git.createWorktree({
          cwd: input.project.workspaceRoot,
          refName: input.project.defaultBranch,
          newRefName: branch,
          path: null,
        });
        const timestamp = new Date().toISOString();
        const sandboxId = SandboxId.make(
          buildSandboxName({
            providerKind: "local",
            taskId: `${input.taskId}-${input.workSessionId}`,
            title: input.title,
          }),
        );
        const resources: SandboxResourceSpec = input.resources ?? {};
        const worktree = {
          workspaceRoot: input.project.workspaceRoot,
          worktreePath: worktreeResult.worktree.path,
          branch: worktreeResult.worktree.refName,
          baseBranch: input.project.defaultBranch,
        };
        const services = buildServiceDescriptors(input);
        const sandbox: SandboxDescriptor = {
          sandboxId,
          providerKind: "local",
          providerRef: {
            providerKind: "local",
            externalId: sandboxId,
            name: buildSandboxName({
              providerKind: "local",
              taskId: `${input.taskId}-${input.workSessionId}`,
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
          environment: String(environment.environmentId),
          worktree,
          ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
          services,
          artifacts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        return {
          sandbox,
          environment,
          services,
          worktree,
        } satisfies SandboxMaterializationResult;
      }).pipe(
        Effect.mapError((error) =>
          sandboxErrorFromUnknown(error, {
            operation: "materialize",
            providerKind: "local",
          }),
        ),
      );
    },
    reconnect(input) {
      return Effect.fail(
        sandboxErrorFromUnknown(new Error("Local Sandbox reconnect is not persisted yet."), {
          operation: "reconnect",
          providerKind: "local",
          sandboxId: input.sandboxId,
        }),
      );
    },
    getStatus(input) {
      return Effect.fail(
        sandboxErrorFromUnknown(new Error("Local Sandbox status lookup is not persisted yet."), {
          operation: "status",
          providerKind: "local",
          sandboxId: input.sandboxId,
        }),
      );
    },
    archive(input) {
      return Effect.fail(
        sandboxErrorFromUnknown(new Error("Local Sandbox archival is not implemented yet."), {
          operation: "archive",
          providerKind: "local",
          sandboxId: input.sandboxId,
        }),
      );
    },
    terminate(input) {
      return Effect.fail(
        sandboxErrorFromUnknown(new Error("Local Sandbox termination is not implemented yet."), {
          operation: "terminate",
          providerKind: "local",
          sandboxId: input.sandboxId,
        }),
      );
    },
  };

  return provider;
});
