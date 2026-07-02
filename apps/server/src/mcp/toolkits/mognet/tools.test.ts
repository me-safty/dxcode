import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { MognetToolkit } from "./tools.ts";

it("exports the Mognet workflow MCP tool catalog", () => {
  expect(Object.keys(MognetToolkit.tools).toSorted()).toEqual([
    "mognet_delegate_task",
    "mognet_project_context",
    "mognet_scheduled_tasks_create",
    "mognet_scheduled_tasks_delete",
    "mognet_scheduled_tasks_list",
    "mognet_scheduled_tasks_run_now",
    "mognet_scheduled_tasks_update",
    "mognet_thread_handoff",
    "mognet_thread_open",
    "mognet_thread_start",
    "mognet_thread_status",
    "mognet_threads_list",
  ]);

  for (const tool of Object.values(MognetToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(tool.name.startsWith("mognet_")).toBe(true);
    expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
  }

  expect(MognetToolkit.tools.mognet_project_context.description).toContain("standalone-chat");
  expect(MognetToolkit.tools.mognet_project_context.description).toContain("internal project IDs");
  expect(MognetToolkit.tools.mognet_project_context.description).toContain("exact thread counts");
  expect(MognetToolkit.tools.mognet_threads_list.description).toContain("chat threads");
  expect(MognetToolkit.tools.mognet_delegate_task.description).toContain(
    "standalone chat scopes use local mode",
  );
  expect(MognetToolkit.tools.mognet_thread_open.description).toContain(
    "Do not call this for general context/status answers",
  );
});
