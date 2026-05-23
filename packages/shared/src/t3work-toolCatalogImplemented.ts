import {
  EMPTY_OBJECT_INPUT_SCHEMA,
  type T3workToolCatalogEntry,
} from "./t3work-toolCatalogCore.js";

export const IMPLEMENTED_T3WORK_TOOL_CATALOG = {
  "t3work.view.read": {
    id: "t3work.view.read",
    label: "Read view",
    title: "Read current t3work view",
    description: "Read the latest thread, project, and current t3work view context.",
    capabilities: ["read"],
    kind: "read",
    surfaces: ["thread"],
    status: "implemented",
    defaultEnabled: true,
    inputSchema: EMPTY_OBJECT_INPUT_SCHEMA,
  },
  "t3work.thread.rename": {
    id: "t3work.thread.rename",
    label: "Rename thread",
    title: "Rename current thread",
    description: "Rename the current thread in t3work.",
    capabilities: ["write"],
    kind: "thread",
    surfaces: ["thread"],
    status: "implemented",
    defaultEnabled: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
          description: "New thread title.",
          minLength: 1,
        },
      },
      required: ["title"],
    },
  },
} as const satisfies Record<string, T3workToolCatalogEntry>;
