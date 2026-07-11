import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { ownedSubagentDescendants } from "./OwnedSubagentTree.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-test" };

function shell(input: {
  readonly id: string;
  readonly parentThreadId?: string;
  readonly relationshipToParent?: "subagent" | "fork";
  readonly rootThreadId?: string;
}): OrchestrationV2ThreadShell {
  const now = DateTime.makeUnsafe("2026-07-09T12:00:00.000Z");
  const id = ThreadId.make(input.id);
  return {
    createdBy: "user",
    creationSource: "web",
    id,
    projectId: ProjectId.make("project:owned-subagent-tree"),
    title: input.id,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: {
      parentThreadId:
        input.parentThreadId === undefined ? null : ThreadId.make(input.parentThreadId),
      relationshipToParent: input.relationshipToParent ?? null,
      rootThreadId: ThreadId.make(input.rootThreadId ?? input.id),
    },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
}

it.effect("walks only recursively owned subagent edges", () =>
  Effect.sync(() => {
    const root = shell({ id: "thread:root" });
    const child = shell({
      id: "thread:child",
      parentThreadId: root.id,
      relationshipToParent: "subagent",
      rootThreadId: root.id,
    });
    const grandchild = shell({
      id: "thread:grandchild",
      parentThreadId: child.id,
      relationshipToParent: "subagent",
      rootThreadId: root.id,
    });
    const fork = shell({
      id: "thread:fork",
      parentThreadId: root.id,
      relationshipToParent: "fork",
      rootThreadId: root.id,
    });
    const forkSubagent = shell({
      id: "thread:fork-subagent",
      parentThreadId: fork.id,
      relationshipToParent: "subagent",
      rootThreadId: root.id,
    });

    assert.deepEqual(
      ownedSubagentDescendants(root.id, [root, grandchild, forkSubagent, fork, child]).map(
        ({ thread, depth }) => [thread.id, depth],
      ),
      [
        [child.id, 1],
        [grandchild.id, 2],
      ],
    );
  }),
);
