import { assert, it } from "@effect/vitest";
import { ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { planOwnedSubagentLifecycleRepairs } from "./OwnedSubagentLifecycleRepair.ts";

const now = DateTime.makeUnsafe("2026-07-09T12:00:00.000Z");

function thread(input: {
  readonly id: string;
  readonly parentThreadId?: string;
  readonly relationshipToParent?: "fork" | "subagent";
  readonly archived?: boolean;
  readonly deleted?: boolean;
}): OrchestrationV2AppThread {
  const id = ThreadId.make(input.id);
  return {
    id,
    lineage: {
      parentThreadId:
        input.parentThreadId === undefined ? null : ThreadId.make(input.parentThreadId),
      relationshipToParent: input.relationshipToParent ?? null,
      rootThreadId: id,
    },
    archivedAt: input.archived === true ? now : null,
    deletedAt: input.deleted === true ? now : null,
  } as unknown as OrchestrationV2AppThread;
}

it.effect("plans grouped repairs only for inconsistent owned-subagent edges", () =>
  Effect.sync(() => {
    const deletedParent = thread({ id: "deleted-parent", deleted: true });
    const firstDeletedChild = thread({
      id: "deleted-child-a",
      parentThreadId: deletedParent.id,
      relationshipToParent: "subagent",
    });
    const secondDeletedChild = thread({
      id: "deleted-child-b",
      parentThreadId: deletedParent.id,
      relationshipToParent: "subagent",
      archived: true,
    });
    const archivedParent = thread({ id: "archived-parent", archived: true });
    const activeArchivedChild = thread({
      id: "active-archived-child",
      parentThreadId: archivedParent.id,
      relationshipToParent: "subagent",
    });
    const alreadyArchivedChild = thread({
      id: "already-archived-child",
      parentThreadId: archivedParent.id,
      relationshipToParent: "subagent",
      archived: true,
    });
    const fork = thread({
      id: "fork",
      parentThreadId: deletedParent.id,
      relationshipToParent: "fork",
    });
    const missingParent = thread({
      id: "missing-parent",
      parentThreadId: "absent",
      relationshipToParent: "subagent",
    });

    assert.deepEqual(
      planOwnedSubagentLifecycleRepairs([
        missingParent,
        secondDeletedChild,
        archivedParent,
        firstDeletedChild,
        deletedParent,
        fork,
        alreadyArchivedChild,
        activeArchivedChild,
      ]),
      [
        {
          type: "delete",
          parentThreadId: deletedParent.id,
          childThreadIds: [firstDeletedChild.id, secondDeletedChild.id],
        },
        {
          type: "archive",
          parentThreadId: archivedParent.id,
          childThreadIds: [activeArchivedChild.id],
        },
      ],
    );
  }),
);
