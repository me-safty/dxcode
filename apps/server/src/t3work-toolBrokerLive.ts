import { CommandId, type ThreadId } from "@t3tools/contracts";
import { isT3workImplementedToolId } from "@t3tools/project-context/t3workToolCatalog";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  T3WORK_CURRENT_VIEW_RESOURCE_URI,
  T3WORK_MCP_SERVER_NAME,
  T3workToolBroker,
  type T3workToolBinding,
  type T3workToolBrokerShape,
  type T3workTurnToolContext,
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
import { T3workThreadToolContextStore } from "./t3work-threadToolContextStore.ts";

const createT3workToolBroker = Effect.fn("createT3workToolBroker")(function* () {
  const query = yield* ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngineService;
  const contextStore = yield* T3workThreadToolContextStore;

  const loadView = (threadId: ThreadId, toolContext: T3workTurnToolContext) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(yield* query.getThreadDetailById(threadId));
      const project = thread
        ? Option.getOrUndefined(yield* query.getProjectShellById(thread.projectId))
        : undefined;
      return {
        surface: toolContext.surface,
        state: toolContext.state,
        project: project
          ? {
              id: project.id,
              title: project.title,
              workspaceRoot: project.workspaceRoot,
            }
          : null,
        thread: thread
          ? {
              id: thread.id,
              projectId: thread.projectId,
              title: thread.title,
              runtimeMode: thread.runtimeMode,
              interactionMode: thread.interactionMode,
              messageCount: thread.messages.length,
              latestTurnId: thread.latestTurn?.turnId ?? null,
            }
          : null,
      };
    });

  const renameThread = (threadId: ThreadId, title: string) =>
    orchestration.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`server:t3work:rename:${crypto.randomUUID()}`),
      threadId,
      title,
    });

  const bindSession: T3workToolBrokerShape["bindSession"] = ({ threadId, toolContext }) =>
    Effect.gen(function* () {
      if (toolContext !== undefined) {
        yield* contextStore.put({ threadId, toolContext });
      }

      const resolvedToolContext = toolContext ?? (yield* contextStore.get(threadId));
      if (!resolvedToolContext || resolvedToolContext.surface !== "t3work") {
        return undefined;
      }

      const toolIds = Array.from(
        new Set(resolvedToolContext.tools.map((tool) => tool.id).filter(isT3workImplementedToolId)),
      );
      if (toolIds.length === 0) {
        return undefined;
      }

      const listServers: T3workToolBinding["listServers"] = () => [
        {
          authStatus: "unsupported",
          name: T3WORK_MCP_SERVER_NAME,
          resourceTemplates: [],
          resources: toolIds.includes("t3work.view.read")
            ? [
                {
                  uri: T3WORK_CURRENT_VIEW_RESOURCE_URI,
                  name: "Current t3work view",
                  mimeType: "application/json",
                  description: "Latest thread and project context for this t3work view.",
                },
              ]
            : [],
          tools: Object.fromEntries(toolIds.map((toolId) => [toolId, TOOL_SPECS[toolId]])),
        },
      ];

      const callTool: T3workToolBinding["callTool"] = ({ server, tool, arguments: toolArgs }) => {
        if (server !== T3WORK_MCP_SERVER_NAME) {
          return Effect.succeed(errorResult(`Unknown MCP server '${server}'.`));
        }
        if (!toolIds.includes(tool as keyof typeof TOOL_SPECS)) {
          return Effect.succeed(errorResult(`Tool '${tool}' is not enabled for this thread.`));
        }
        if (tool === "t3work.thread.rename") {
          const title = readRenameTitle(toolArgs);
          if (!title) {
            return Effect.succeed(
              errorResult("t3work.thread.rename requires a non-empty 'title'."),
            );
          }
          return foldResult(
            renameThread(threadId, title),
            () => okResult({ ok: true, threadId, title }),
            (message) => errorResult(`Failed to rename thread: ${message}`),
          );
        }
        return foldResult(loadView(threadId, resolvedToolContext), okResult, (message) =>
          errorResult(`Failed to read t3work view: ${message}`),
        );
      };

      const readResource: T3workToolBinding["readResource"] = ({ server, uri }) => {
        if (server !== T3WORK_MCP_SERVER_NAME) {
          return Effect.succeed(resourceResult(uri, { error: `Unknown MCP server '${server}'.` }));
        }
        if (uri !== T3WORK_CURRENT_VIEW_RESOURCE_URI || !toolIds.includes("t3work.view.read")) {
          return Effect.succeed(
            resourceResult(uri, { error: `Resource '${uri}' is not available for this thread.` }),
          );
        }
        return foldResource(loadView(threadId, resolvedToolContext), uri, (value) =>
          resourceResult(uri, value),
        );
      };

      return { threadId, listServers, callTool, readResource } satisfies T3workToolBinding;
    });

  return { bindSession } satisfies T3workToolBrokerShape;
});

export const T3workToolBrokerLive = Layer.effect(T3workToolBroker, createT3workToolBroker());
