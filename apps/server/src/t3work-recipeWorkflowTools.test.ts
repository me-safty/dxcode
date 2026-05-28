import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { type OrchestrationCommand, ThreadId } from "@t3tools/contracts";
import type { ProjectRecipeWorkflowLaunch } from "@t3tools/project-recipes";
import { describe, expect, it } from "vitest";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.ts";
import { runProjectRecipeWorkflowLaunch } from "./t3work-recipeWorkflowRuntime.js";
import { T3workToolBroker } from "./t3work-toolBroker.ts";
import { createThreadToolContext, makeBrokerLayer } from "./t3work-toolBrokerTestUtils.ts";

const CREATED_AT = "2026-05-28T14:00:00.000Z";

function createMockOrchestration() {
  const commands: OrchestrationCommand[] = [];
  const orchestration: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
    streamDomainEvents: Stream.empty,
  };
  return { orchestration, commands };
}

function activityCommands(commands: ReadonlyArray<OrchestrationCommand>) {
  return commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
      command.type === "thread.activity.append",
  );
}

const makeTempWorkspace = Effect.fn("makeTempWorkspace")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3work-workflow-tools-" });
});

const writeRecipeFiles = Effect.fn("writeRecipeFiles")(function* (input: {
  readonly workspaceRoot: string;
  readonly workflowSource: string;
  readonly scriptSource?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const recipeRoot = `${input.workspaceRoot}/.t3work/recipes/tool-check`;
  yield* fileSystem.makeDirectory(recipeRoot, { recursive: true });
  yield* fileSystem.writeFileString(`${recipeRoot}/workflow.ts`, input.workflowSource);
  if (input.scriptSource) {
    yield* fileSystem.writeFileString(`${recipeRoot}/recipe-script.ts`, input.scriptSource);
  }
  return { recipeRoot, workflowPath: `${recipeRoot}/workflow.ts` };
});

function buildLaunch(workflowPath: string, recipePath: string) {
  return {
    kind: "recipe",
    recipeId: "tool-check",
    recipeVersion: "0.1.0",
    title: "Tool check",
    description: "Exercise workflow tools.",
    source: "project-local",
    surface: "workitem.detail.sidepanel",
    recipePath,
    workflowPath,
    allowedToolGroups: ["integration.read"],
  } satisfies ProjectRecipeWorkflowLaunch;
}

describe("runProjectRecipeWorkflowLaunch tool enforcement", () => {
  it("allows read tools and rejects draft-mutation tool steps", async () => {
    const { orchestration, commands } = createMockOrchestration();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const workspaceRoot = yield* makeTempWorkspace();
          const { recipeRoot, workflowPath } = yield* writeRecipeFiles({
            workspaceRoot,
            workflowSource: [
              "export const steps = [",
              '  { kind: "tool", id: "read-view", toolName: "t3work.view.read" },',
              '  { kind: "tool", id: "rename-draft", toolName: "t3work.thread.rename.draft_update", input: { title: "Blocked" } },',
              "];",
              "",
            ].join("\n"),
          });
          const threadId = ThreadId.make("thread-workflow-tool-step");
          const broker = yield* T3workToolBroker;

          yield* broker.bindSession({
            threadId,
            toolContext: createThreadToolContext({
              tools: [
                { id: "t3work.view.read", label: "Read view", capabilities: ["read"] },
                {
                  id: "t3work.thread.rename.draft_update",
                  label: "Rename draft",
                  capabilities: ["write"],
                },
              ],
            }),
          });
          yield* runProjectRecipeWorkflowLaunch({
            orchestration,
            threadId,
            workspaceRoot,
            launch: buildLaunch(workflowPath, recipeRoot),
            kickoffMessage: "Check workflow tools",
            createdAt: CREATED_AT,
          });

          const activities = activityCommands(commands);
          expect(activities.map((command) => command.activity.summary)).toEqual(
            expect.arrayContaining([
              "Completed tool step read-view",
              "Workflow tool step rename-draft failed",
            ]),
          );
          expect(
            activities.find(
              (command) => command.activity.summary === "Workflow tool step rename-draft failed",
            )?.activity.payload,
          ).toEqual(
            expect.objectContaining({
              error: expect.stringContaining("requires group 'mutation.draft'"),
            }),
          );
        }).pipe(Effect.provide(makeBrokerLayer(orchestration))),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
  });

  it("binds script api.tools.call and readResource through the broker", async () => {
    const { orchestration } = createMockOrchestration();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const workspaceRoot = yield* makeTempWorkspace();
          const { recipeRoot, workflowPath } = yield* writeRecipeFiles({
            workspaceRoot,
            workflowSource: [
              "export const steps = [",
              '  { kind: "script", id: "use-tools", module: "./recipe-script.ts#useTools" },',
              "];",
              "",
            ].join("\n"),
            scriptSource: [
              "export async function useTools(_context, api) {",
              '  const view = await api.tools.call("t3work.view.read");',
              '  const resource = await api.tools.readResource("t3work://view/current");',
              '  await api.workspace.writeText("artifacts/view.json", JSON.stringify({ view, resource }, null, 2) + "\\n");',
              "  try {",
              '    await api.tools.call("t3work.thread.rename.draft_update", { title: "Blocked" });',
              "  } catch (error) {",
              '    await api.workspace.writeText("artifacts/error.txt", String(error instanceof Error ? error.message : error) + "\\n");',
              "  }",
              "}",
              "",
            ].join("\n"),
          });
          const threadId = ThreadId.make("thread-workflow-script-step");
          const broker = yield* T3workToolBroker;

          yield* broker.bindSession({
            threadId,
            toolContext: createThreadToolContext({
              tools: [
                { id: "t3work.view.read", label: "Read view", capabilities: ["read"] },
                {
                  id: "t3work.thread.rename.draft_update",
                  label: "Rename draft",
                  capabilities: ["write"],
                },
              ],
            }),
          });
          yield* runProjectRecipeWorkflowLaunch({
            orchestration,
            threadId,
            workspaceRoot,
            launch: buildLaunch(workflowPath, recipeRoot),
            kickoffMessage: "Use script tools",
            createdAt: CREATED_AT,
          });

          const fileSystem = yield* FileSystem.FileSystem;
          const viewJson = yield* fileSystem.readFileString(`${recipeRoot}/artifacts/view.json`);
          const errorText = yield* fileSystem.readFileString(`${recipeRoot}/artifacts/error.txt`);

          expect(viewJson).toContain('"view"');
          expect(viewJson).toContain('"resource"');
          expect(viewJson).toContain('"thread"');
          expect(errorText).toContain("requires group 'mutation.draft'");
        }).pipe(Effect.provide(makeBrokerLayer(orchestration))),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
  });
});
