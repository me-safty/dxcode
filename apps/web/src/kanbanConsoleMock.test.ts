import { describe, expect, it } from "vitest";

import {
  getLocaleDirection,
  getMessages,
  getTasksByColumn,
  kanbanConsoleMessages,
  kanbanTasks,
  moveTaskToColumn,
  type KanbanColumnId,
} from "./kanbanConsoleMock";

describe("kanbanConsoleMock", () => {
  it("keeps Arabic and English message keys aligned", () => {
    expect(Object.keys(kanbanConsoleMessages.ar).toSorted()).toEqual(
      Object.keys(kanbanConsoleMessages.en).toSorted(),
    );
  });

  it("resolves locale direction for RTL checks", () => {
    expect(getLocaleDirection("en")).toBe("ltr");
    expect(getLocaleDirection("ar")).toBe("rtl");
  });

  it("groups every mock task into one board column", () => {
    const groupedTaskIds = getTasksByColumn()
      .flatMap((column) => column.tasks)
      .map((task) => task.id)
      .toSorted();

    expect(groupedTaskIds).toEqual(kanbanTasks.map((task) => task.id).toSorted());
  });

  it("moves a task without mutating other cards", () => {
    const [targetTask, untouchedTask] = kanbanTasks;
    expect(targetTask).toBeDefined();
    expect(untouchedTask).toBeDefined();

    if (!targetTask || !untouchedTask) {
      throw new Error("mock task fixture is incomplete");
    }

    const nextColumn: KanbanColumnId = "review";
    const movedTasks = moveTaskToColumn(kanbanTasks, targetTask.id, nextColumn);

    expect(movedTasks.find((task) => task.id === targetTask.id)?.column).toBe(nextColumn);
    expect(movedTasks.find((task) => task.id === untouchedTask.id)).toEqual(untouchedTask);
    expect(kanbanTasks[0]?.column).not.toBe(nextColumn);
  });

  it("returns locale-specific labels", () => {
    expect(getMessages("en").consoleTitle).toBe("Kanban Project Console");
    expect(getMessages("ar").consoleTitle).toBe("وحدة تحكم مشروع كانبان");
  });
});
