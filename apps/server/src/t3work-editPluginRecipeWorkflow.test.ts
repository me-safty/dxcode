import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { type OrchestrationCommand, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.js";
import { renderBundledRecipeSetupFiles } from "./t3work-projectSetupRecipes.ts";
import {
  runProjectRecipeWorkflowLaunch,
  resumeProjectRecipeWorkflowAfterAgentReply,
  submitProjectRecipeCardAction,
} from "./t3work-recipeWorkflowRuntime.js";
import { workflowRunRecipeRootPath } from "./t3work-recipeWorkflowRunPaths.ts";
import { workflowRunIdForThread } from "./t3work-recipeWorkflowRuntimeShared.ts";

const CREATED_AT = "2026-05-29T10:00:00.000Z";

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

function messageUpsertCommands(commands: ReadonlyArray<OrchestrationCommand>) {
  return commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: "thread.message.upsert" }> =>
      command.type === "thread.message.upsert",
  );
}

describe("edit-plugin-module workflow", () => {
  it("drafts a diff preview and saves the approved source back to the workspace", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const pathService = yield* Path.Path;
          const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3work-edit-plugin-module-",
          });
          const threadId = ThreadId.make("thread-edit-plugin-module");
          const workflowRunId = workflowRunIdForThread(threadId);
          const runRootPath = workflowRunRecipeRootPath(pathService, workspaceRoot, workflowRunId);
          const recipeRoot = `${workspaceRoot}/.t3work/recipes/edit-plugin-module`;
          const targetPath = `${workspaceRoot}/plugins/quick-starts.ts`;
          const { orchestration, commands } = createMockOrchestration();

          for (const file of renderBundledRecipeSetupFiles().filter((entry) =>
            entry.relativePath.startsWith(".t3work/recipes/edit-plugin-module/"),
          )) {
            const absolutePath = pathService.join(workspaceRoot, file.relativePath);
            yield* fileSystem.makeDirectory(pathService.dirname(absolutePath), { recursive: true });
            yield* fileSystem.writeFileString(absolutePath, file.contents);
          }

          yield* fileSystem.makeDirectory(pathService.dirname(targetPath), { recursive: true });
          yield* fileSystem.writeFileString(
            targetPath,
            [
              "export const recipe = createBundledRecipe({",
              '  id: "example-recipe",',
              '  title: "Example recipe",',
              '  shortDescription: "Old description.",',
              '  surfaces: ["workitem.detail.sidepanel"],',
              '  promptTemplate: "Old prompt.",',
              "});",
              "",
            ].join("\n"),
          );

          const launchResult = yield* runProjectRecipeWorkflowLaunch({
            orchestration,
            threadId,
            workspaceRoot,
            kickoffMessage:
              "Tighten the short description and preserve the current kickoff structure.",
            createdAt: CREATED_AT,
            launch: {
              kind: "recipe",
              recipeId: "edit-plugin-module",
              recipeVersion: "0.1.0",
              parameters: { targetPath: "plugins/quick-starts.ts" },
              title: "Edit this item",
              description:
                "Draft and apply a surgical edit to an existing project-local recipe or plugin module.",
              source: "project-local",
              surface: "workitem.detail.sidepanel",
              recipePath: recipeRoot,
              workflowPath: `${recipeRoot}/workflow.ts`,
              allowedToolGroups: ["integration.read", "artifact.rw", "ui.render"],
            },
          });

          expect(launchResult.turnStartMessage).toContain(
            "Active guidance section: bundled-recipe",
          );
          expect(launchResult.turnStartMessage).toContain(
            pathService.join("runs", workflowRunId, "recipe", "artifacts", "proposed-source.txt"),
          );

          yield* fileSystem.writeFileString(
            pathService.join(runRootPath, "artifacts", "proposed-source.txt"),
            [
              "export const recipe = createBundledRecipe({",
              '  id: "example-recipe",',
              '  title: "Example recipe",',
              '  shortDescription: "Targeted edits for the selected item.",',
              '  surfaces: ["workitem.detail.sidepanel"],',
              '  promptTemplate: "Old prompt.",',
              "});",
              "",
            ].join("\n"),
          );

          yield* resumeProjectRecipeWorkflowAfterAgentReply({
            orchestration,
            workspaceRoot,
            threadId,
            messageText: "Draft ready.",
            createdAt: "2026-05-29T10:00:10.000Z",
          });

          const previewDiff = yield* fileSystem.readFileString(
            pathService.join(runRootPath, "artifacts", "proposed.diff"),
          );
          expect(previewDiff).toContain("--- a/plugins/quick-starts.ts");
          expect(previewDiff).toContain(
            '+  shortDescription: "Targeted edits for the selected item.",',
          );
          expect(
            messageUpsertCommands(commands).some(
              (command) =>
                command.message.t3workExt?.attachments?.some(
                  (attachment) => attachment.kind === "view",
                ) === true,
            ),
          ).toBe(true);

          yield* submitProjectRecipeCardAction({
            orchestration,
            workspaceRoot,
            threadId,
            cardId: "edit-preview-card",
            actionId: "approve",
            createdAt: "2026-05-29T10:00:20.000Z",
          });

          const updatedTarget = yield* fileSystem.readFileString(targetPath);
          const workflowStateExists = yield* fileSystem.exists(
            `${workspaceRoot}/.t3work/recipe-workflows/${threadId}.json`,
          );

          expect(updatedTarget).toContain(
            'shortDescription: "Targeted edits for the selected item."',
          );
          expect(workflowStateExists).toBe(false);
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );
  });
});
