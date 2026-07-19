import { ProjectId, ProjectTaskId, type ProjectTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  oppositeTaskStatus,
  taskMoveTarget,
  tasksForStatus,
  taskThreadDraft,
} from "./projectDashboard.logic";

const projectId = ProjectId.make("project-dashboard");
const task = (
  id: string,
  status: ProjectTask["status"],
  position: number,
  description = "",
): ProjectTask => ({
  id: ProjectTaskId.make(id),
  projectId,
  title: id,
  description,
  status,
  position,
  threadId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  completedAt: status === "done" ? "2026-07-01T00:00:00.000Z" : null,
});

describe("project dashboard task flow", () => {
  it("groups deterministically and derives reorder and completion commands", () => {
    const tasks = [
      task("task-b", "open", 1),
      task("task-done", "done", 0),
      task("task-a", "open", 0),
    ];
    const open = tasksForStatus(tasks, "open");

    expect(open.map(({ id }) => id)).toEqual(["task-a", "task-b"]);
    expect(taskMoveTarget(open, 1, "up")).toBe("task-a");
    expect(taskMoveTarget(open, 0, "down")).toBeNull();
    expect(oppositeTaskStatus("open")).toBe("done");
    expect(oppositeTaskStatus("done")).toBe("open");
  });

  it("builds the prompt used when starting a task thread", () => {
    expect(taskThreadDraft(task("Implement dashboard", "open", 0, "Cover transport flow"))).toBe(
      "Implement dashboard\n\nCover transport flow",
    );
    expect(taskThreadDraft(task("No description", "open", 0))).toBe("No description");
  });
});
