import type { ThreadId } from "@t3tools/contracts";
import {
  PROJECT_RECIPE_PRELAUNCH_TOOL_GROUP_IDS,
  PROJECT_RECIPE_TOOL_GROUP_BY_TOOL_ID,
  getProjectRecipeToolGroupForToolId,
  normalizeProjectRecipeToolGroups,
  type ProjectRecipeToolGroupId,
} from "@t3tools/project-recipes";
import * as Effect from "effect/Effect";

import {
  T3WORK_CURRENT_VIEW_RESOURCE_URI,
  T3WORK_MCP_SERVER_NAME,
  type T3workPrelaunchToolBinding,
  type T3workToolBinding,
} from "./t3work-toolBroker.ts";
import {
  TOOL_SPECS,
  errorResult,
  foldResource,
  foldResult,
  okResult,
  readRenameTitle,
  resourceResult,
} from "./t3work-toolBrokerHelpers.ts";

type CreateBindingInput<TRenameError = never, TStartChildError = never, TReadError = never> = {
  readonly availableToolIds: ReadonlyArray<string>;
  readonly allowedToolGroups?: ReadonlyArray<string> | undefined;
  readonly scopeLabel: string;
  readonly prelaunchOnly?: boolean;
  readonly readView: () => Effect.Effect<unknown, TReadError>;
  readonly renameThread?: (title: string) => Effect.Effect<unknown, TRenameError>;
  readonly renameThreadResult?: (title: string) => unknown;
  readonly startChild?: (arguments_: unknown) => Effect.Effect<unknown, TStartChildError>;
};

function formatAllowedToolGroups(groups: ReadonlyArray<ProjectRecipeToolGroupId>): string {
  return `[${groups.map((group) => `'${group}'`).join(", ")}]`;
}

function buildBindingState<TRenameError, TStartChildError, TReadError>(
  input: CreateBindingInput<TRenameError, TStartChildError, TReadError>,
) {
  const normalizedGroups = normalizeProjectRecipeToolGroups(input.allowedToolGroups);
  const effectiveGroups =
    normalizedGroups === undefined
      ? undefined
      : input.prelaunchOnly
        ? normalizedGroups.filter((group) =>
            PROJECT_RECIPE_PRELAUNCH_TOOL_GROUP_IDS.some((candidate) => candidate === group),
          )
        : normalizedGroups;
  const availableToolIds = [...new Set(input.availableToolIds)];
  const availableToolIdSet = new Set(availableToolIds);
  const allowedToolIds =
    effectiveGroups === undefined
      ? availableToolIds
      : availableToolIds.filter((toolId) => {
          const group = getProjectRecipeToolGroupForToolId(toolId);
          return group !== undefined && effectiveGroups.includes(group);
        });
  const allowedToolIdSet = new Set(allowedToolIds);
  return { availableToolIdSet, allowedToolIds, allowedToolIdSet, effectiveGroups };
}

function permissionMessage(
  toolId: string,
  effectiveGroups: ReadonlyArray<ProjectRecipeToolGroupId>,
): string {
  const requiredGroup = getProjectRecipeToolGroupForToolId(toolId);
  return requiredGroup
    ? `Tool '${toolId}' requires group '${requiredGroup}' but recipe declares only ${formatAllowedToolGroups(effectiveGroups)}.`
    : `Tool '${toolId}' is not classified in the recipe tool-group registry.`;
}

function createToolSurface<TRenameError, TStartChildError, TReadError>(
  input: CreateBindingInput<TRenameError, TStartChildError, TReadError>,
) {
  const state = buildBindingState(input);

  const callTool: T3workToolBinding["callTool"] = ({ server, tool, arguments: toolArgs }) => {
    if (server !== T3WORK_MCP_SERVER_NAME) {
      return Effect.succeed(errorResult(`Unknown MCP server '${server}'.`));
    }
    if (!state.availableToolIdSet.has(tool)) {
      return Effect.succeed(errorResult(`Tool '${tool}' is not enabled ${input.scopeLabel}.`));
    }
    if (state.effectiveGroups && !state.allowedToolIdSet.has(tool)) {
      return Effect.succeed(errorResult(permissionMessage(tool, state.effectiveGroups)));
    }
    if (tool === "t3work.thread.rename") {
      if (!input.renameThread) {
        return Effect.succeed(errorResult(`Tool '${tool}' is not enabled ${input.scopeLabel}.`));
      }
      const title = readRenameTitle(toolArgs);
      if (!title) {
        return Effect.succeed(errorResult("t3work.thread.rename requires a non-empty 'title'."));
      }
      return foldResult(
        input.renameThread(title),
        () =>
          okResult(
            input.renameThreadResult ? input.renameThreadResult(title) : { ok: true, title },
          ),
        (message) => errorResult(`Failed to rename thread: ${message}`),
      );
    }
    if (tool === "t3work.thread.start_child") {
      if (!input.startChild) {
        return Effect.succeed(errorResult(`Tool '${tool}' is not enabled ${input.scopeLabel}.`));
      }
      return foldResult(input.startChild(toolArgs), okResult, (message) =>
        errorResult(`Failed to start child session: ${message}`),
      );
    }
    if (tool !== "t3work.view.read") {
      return Effect.succeed(errorResult(`Tool '${tool}' is not implemented in this runtime.`));
    }
    return foldResult(input.readView(), okResult, (message) =>
      errorResult(`Failed to read t3work view: ${message}`),
    );
  };

  const readResource: T3workToolBinding["readResource"] = ({ server, uri }) => {
    if (server !== T3WORK_MCP_SERVER_NAME) {
      return Effect.succeed(resourceResult(uri, { error: `Unknown MCP server '${server}'.` }));
    }
    if (uri !== T3WORK_CURRENT_VIEW_RESOURCE_URI) {
      return Effect.succeed(resourceResult(uri, { error: `Resource '${uri}' is not available.` }));
    }
    if (!state.availableToolIdSet.has("t3work.view.read")) {
      return Effect.succeed(resourceResult(uri, { error: `Resource '${uri}' is not available.` }));
    }
    if (state.effectiveGroups && !state.allowedToolIdSet.has("t3work.view.read")) {
      return Effect.succeed(
        resourceResult(uri, {
          error: permissionMessage("t3work.view.read", state.effectiveGroups),
        }),
      );
    }
    return foldResource(input.readView(), uri, (value) => resourceResult(uri, value));
  };

  return {
    listServers: () => [
      {
        authStatus: "unsupported" as const,
        name: T3WORK_MCP_SERVER_NAME,
        resourceTemplates: [],
        resources: state.allowedToolIdSet.has("t3work.view.read")
          ? [
              {
                uri: T3WORK_CURRENT_VIEW_RESOURCE_URI,
                name: "Current t3work view",
                mimeType: "application/json",
                description: "Latest thread and project context for this t3work view.",
              },
            ]
          : [],
        tools: Object.fromEntries(
          state.allowedToolIds.flatMap((toolId) => {
            const spec = TOOL_SPECS[toolId as keyof typeof TOOL_SPECS];
            return spec ? [[toolId, spec] as const] : [];
          }),
        ),
      },
    ],
    callTool,
    readResource,
  };
}

export function createT3workThreadToolBinding<TRenameError, TStartChildError, TReadError>(
  input: Omit<
    CreateBindingInput<TRenameError, TStartChildError, TReadError>,
    "scopeLabel" | "prelaunchOnly"
  > & {
    readonly threadId: ThreadId;
  },
): T3workToolBinding {
  return {
    threadId: input.threadId,
    ...createToolSurface({ ...input, scopeLabel: "for this thread." }),
  };
}

export function createT3workPrelaunchToolBinding<TRenameError, TStartChildError, TReadError>(
  input: Omit<
    CreateBindingInput<TRenameError, TStartChildError, TReadError>,
    "availableToolIds" | "prelaunchOnly" | "scopeLabel"
  > & {
    readonly workspaceRoot: string;
    readonly callerKind: "visibility" | "view.preRender";
  },
): T3workPrelaunchToolBinding {
  return {
    bindingKey: `${input.callerKind}:${input.workspaceRoot}`,
    ...createToolSurface({
      ...input,
      availableToolIds: Object.keys(PROJECT_RECIPE_TOOL_GROUP_BY_TOOL_ID),
      prelaunchOnly: true,
      scopeLabel: `during ${input.callerKind} evaluation.`,
    }),
  };
}
