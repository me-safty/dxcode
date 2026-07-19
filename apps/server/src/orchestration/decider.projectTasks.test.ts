import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProjectTaskId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-07-19T00:00:00.000Z";
const projectId = ProjectId.make("project-dashboard");

function event(
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: unknown,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "project",
    aggregateId: projectId,
    type,
    occurredAt: now,
    commandId: CommandId.make(`command-${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload,
  } as OrchestrationEvent;
}

const withProject = projectEvent(
  createEmptyReadModel(now),
  event(1, "project.created", {
    projectId,
    title: "Dashboard",
    workspaceRoot: "/tmp/dashboard",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  }),
);

it.layer(NodeServices.layer)("project task decider", (it) => {
  it.effect("appends created tasks and moves them sequentially", () =>
    Effect.gen(function* () {
      let model = yield* withProject;
      for (const [index, id] of ["task-a", "task-b"].entries()) {
        const decided = yield* decideOrchestrationCommand({
          readModel: model,
          command: {
            type: "project.task.create",
            commandId: CommandId.make(`create-${id}`),
            taskId: ProjectTaskId.make(id),
            projectId,
            title: id,
            description: "",
            createdAt: now,
          },
        });
        const created = Array.isArray(decided) ? decided[0]! : decided;
        model = yield* projectEvent(model, { ...created, sequence: index + 2 });
      }
      expect(model.tasks?.map((task) => task.position)).toEqual([0, 1]);

      const moved = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "project.task.move",
          commandId: CommandId.make("move-task-b"),
          taskId: ProjectTaskId.make("task-b"),
          beforeTaskId: ProjectTaskId.make("task-a"),
          status: "open",
        },
      });
      expect(Array.isArray(moved)).toBe(true);
      expect((moved as readonly OrchestrationEvent[]).map((entry) => entry.payload)).toEqual([
        expect.objectContaining({ taskId: "task-a", position: 1 }),
        expect.objectContaining({ taskId: "task-b", position: 0 }),
      ]);
    }),
  );

  it.effect("creates and links a task thread in one decision", () =>
    Effect.gen(function* () {
      const model = yield* projectEvent(
        yield* withProject,
        event(2, "project.task-created", {
          task: {
            id: "task-a",
            projectId,
            title: "Task",
            description: "",
            status: "open",
            position: 0,
            threadId: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
        }),
      );
      const decided = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.create",
          commandId: CommandId.make("create-linked-thread"),
          threadId: ThreadId.make("thread-a"),
          projectId,
          sourceTaskId: ProjectTaskId.make("task-a"),
          title: "Task",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
      });
      expect(Array.isArray(decided) && decided.map((entry) => entry.type)).toEqual([
        "thread.created",
        "project.task-thread-linked",
      ]);
    }),
  );

  it.effect("rejects a stale move target", () =>
    Effect.gen(function* () {
      const model = yield* projectEvent(
        yield* withProject,
        event(2, "project.task-created", {
          task: {
            id: "task-a",
            projectId,
            title: "Task",
            description: "",
            status: "open",
            position: 0,
            threadId: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
        }),
      );
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: model,
          command: {
            type: "project.task.move",
            commandId: CommandId.make("move-before-deleted-task"),
            taskId: ProjectTaskId.make("task-a"),
            beforeTaskId: ProjectTaskId.make("deleted-task"),
            status: "open",
          },
        }),
      );
      expect(failure.message).toContain("Task 'deleted-task' does not exist.");
    }),
  );

  it.effect("rejects moving a task before itself", () =>
    Effect.gen(function* () {
      const taskId = ProjectTaskId.make("task-a");
      const model = yield* projectEvent(
        yield* withProject,
        event(2, "project.task-created", {
          task: {
            id: taskId,
            projectId,
            title: "Task",
            description: "",
            status: "open",
            position: 0,
            threadId: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
        }),
      );
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: model,
          command: {
            type: "project.task.move",
            commandId: CommandId.make("move-before-self"),
            taskId,
            beforeTaskId: taskId,
            status: "open",
          },
        }),
      );
      expect(failure.message).toContain("beforeTaskId must differ from taskId.");
    }),
  );
});
