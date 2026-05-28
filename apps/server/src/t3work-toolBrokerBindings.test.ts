import { describe, expect, it } from "vitest";
import { createQueryable } from "@t3tools/project-context";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.ts";
import { T3workToolBroker } from "./t3work-toolBroker.ts";
import {
  createThreadToolContext,
  makeBrokerLayer,
  threadId,
} from "./t3work-toolBrokerTestUtils.ts";

const orchestrationMock: OrchestrationEngineShape = {
  readEvents: () => Stream.empty,
  dispatch: () => Effect.succeed({ sequence: 1 }),
  streamDomainEvents: Stream.empty,
};

function makeRenderContext() {
  return {
    surface: "workitem.detail.sidepanel" as const,
    project: {
      title: "Project One",
      provider: "atlassian",
    },
    workitem: {
      kind: "ticket" as const,
      displayId: "PROJ-42",
      type: "Bug",
      provider: "jira",
    },
    linkedResources: createQueryable([]),
    artifacts: createQueryable([]),
    profile: {
      technicalDepth: "medium" as const,
      brevity: "balanced" as const,
      guidanceStyle: "guided" as const,
      detailDensity: "balanced" as const,
      preferredArtifactKinds: ["implementation-plan"],
      defaultActionFamilies: ["engineering"],
      defaultRecipeWeights: {},
    },
    enabledSkillPacks: ["engineering"],
    schema: {},
    availableContextKeys: createQueryable(["ticket.summary"]),
  };
}

describe("T3workToolBroker allowed tool groups", () => {
  it("allows thread read tools and rejects disallowed write tools", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* T3workToolBroker;
        const binding = yield* broker.bindSession({
          threadId,
          toolContext: createThreadToolContext({
            tools: [
              { id: "t3work.view.read", label: "Read view", capabilities: ["read"] },
              { id: "t3work.thread.rename", label: "Rename thread", capabilities: ["write"] },
            ],
          }),
          allowedToolGroups: ["integration.read"],
        });

        const readResult = yield* binding!.callTool({ server: "t3work", tool: "t3work.view.read" });
        const writeResult = yield* binding!.callTool({
          server: "t3work",
          tool: "t3work.thread.rename",
          arguments: { title: "Renamed" },
        });

        return { binding, readResult, writeResult };
      }).pipe(Effect.provide(makeBrokerLayer(orchestrationMock))),
    );

    expect(result.binding?.listServers()[0]?.tools).toEqual({
      "t3work.view.read": expect.objectContaining({ name: "t3work.view.read" }),
    });
    expect(result.readResult.isError).toBeUndefined();
    expect(result.writeResult.isError).toBe(true);
    expect(result.writeResult.content[0]?.text).toContain("requires group 'view.state'");
  });

  it("binds visibility in no-thread read-only mode", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* T3workToolBroker;
        const binding = yield* broker.bindReadOnly({
          workspaceRoot: "/workspace/project-1",
          callerKind: "visibility",
          renderContext: makeRenderContext(),
          allowedToolGroups: ["integration.read"],
        });

        const readResult = yield* binding!.callTool({ server: "t3work", tool: "t3work.view.read" });
        const writeResult = yield* binding!.callTool({
          server: "t3work",
          tool: "t3work.thread.rename",
          arguments: { title: "Renamed" },
        });

        return { binding, readResult, writeResult };
      }).pipe(Effect.provide(makeBrokerLayer(orchestrationMock))),
    );

    expect(result.binding?.listServers()[0]?.tools).toEqual({
      "t3work.view.read": expect.objectContaining({ name: "t3work.view.read" }),
    });
    expect(result.readResult.structuredContent).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ workspaceRoot: "/workspace/project-1" }),
        thread: null,
      }),
    );
    expect(result.writeResult.isError).toBe(true);
    expect(result.writeResult.content[0]?.text).toContain("requires group 'view.state'");
  });
});
