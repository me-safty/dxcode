import type { ProjectTask, ProjectTaskId, ProjectTaskStatus } from "@t3tools/contracts";

export function tasksForStatus(
  tasks: ReadonlyArray<ProjectTask>,
  status: ProjectTaskStatus,
): ReadonlyArray<ProjectTask> {
  return tasks
    .filter((task) => task.status === status)
    .toSorted((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function taskMoveTarget(
  tasks: ReadonlyArray<ProjectTask>,
  index: number,
  direction: "up" | "down",
): ProjectTaskId | null {
  if (direction === "up") return tasks[index - 1]?.id ?? null;
  return tasks[index + 2]?.id ?? null;
}

export function taskThreadDraft(task: Pick<ProjectTask, "title" | "description">): string {
  return task.description.length === 0 ? task.title : `${task.title}\n\n${task.description}`;
}

export function oppositeTaskStatus(status: ProjectTaskStatus): ProjectTaskStatus {
  return status === "open" ? "done" : "open";
}
