import { describe, expect, it, vi } from "vitest";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.ts";
import { T3workToolBroker, T3WORK_CURRENT_VIEW_RESOURCE_URI } from "./t3work-toolBroker.ts";
import { makeBrokerLayer, threadId } from "./t3work-toolBrokerTestUtils.ts";

describe("T3workToolBrokerLive", () => {
  it("lists selected tools and returns the current view payload", async () => {
    const orchestrationMock: OrchestrationEngineShape = {
      readEvents: () => Stream.empty,
      dispatch: () => Effect.succeed({ sequence: 1 }),
      streamDomainEvents: Stream.empty,
    };

    const binding = await Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* T3workToolBroker;
        return yield* broker.bindSession({
          threadId,
          toolContext: {
            surface: "t3work",
            tools: [{ id: "t3work.view.read", label: "Read view", capabilities: ["read"] }],
            state: {
              view: {
                kind: "thread",
                projectId: "project-1",
                projectTitle: "Project One",
                workspaceRoot: "/workspace/project-1",
                threadId,
                threadTitle: "Original title",
              },
            },
          },
        });
      }).pipe(Effect.provide(makeBrokerLayer(orchestrationMock))),
    );

    expect(binding?.listServers()).toEqual([
      expect.objectContaining({
        name: "t3work",
        tools: {
          "t3work.view.read": expect.objectContaining({ title: "Read current t3work view" }),
        },
        resources: [
          expect.objectContaining({
            uri: T3WORK_CURRENT_VIEW_RESOURCE_URI,
            name: "Current t3work view",
          }),
        ],
      }),
    ]);

    const result = await Effect.runPromise(
      binding!.callTool({ server: "t3work", tool: "t3work.view.read" }),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ id: "project-1" }),
        thread: expect.objectContaining({ id: threadId, title: "Original title" }),
      }),
    );
  });

  it("dispatches thread metadata updates for rename", async () => {
    const dispatch = vi.fn((_command: unknown) => Promise.resolve({ sequence: 7 }));
    const orchestrationMock: OrchestrationEngineShape = {
      readEvents: () => Stream.empty,
      dispatch: (command) => Effect.promise(() => dispatch(command)),
      streamDomainEvents: Stream.empty,
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* T3workToolBroker;
        const binding = yield* broker.bindSession({
          threadId,
          toolContext: {
            surface: "t3work",
            tools: [
              {
                id: "t3work.thread.rename",
                label: "Rename thread",
                capabilities: ["write"],
              },
            ],
            state: {
              view: {
                kind: "thread",
                projectId: "project-1",
                projectTitle: "Project One",
                workspaceRoot: "/workspace/project-1",
                threadId,
                threadTitle: "Original title",
              },
            },
          },
        });
        return yield* binding!.callTool({
          server: "t3work",
          tool: "t3work.thread.rename",
          arguments: { title: "  Updated title  " },
        });
      }).pipe(Effect.provide(makeBrokerLayer(orchestrationMock))),
    );

    expect(result).toEqual(
      expect.objectContaining({
        structuredContent: {
          ok: true,
          threadId,
          title: "Updated title",
        },
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "thread.meta.update",
        threadId,
        title: "Updated title",
      }),
    );
  });

  it("falls back to the stored thread tool context when no toolContext is passed", async () => {
    const orchestrationMock: OrchestrationEngineShape = {
      readEvents: () => Stream.empty,
      dispatch: () => Effect.succeed({ sequence: 1 }),
      streamDomainEvents: Stream.empty,
    };

    const binding = await Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* T3workToolBroker;
        yield* broker.bindSession({
          threadId,
          toolContext: {
            surface: "t3work",
            tools: [{ id: "t3work.view.read", label: "Read view", capabilities: ["read"] }],
            state: {
              view: {
                kind: "thread",
                projectId: "project-1",
                projectTitle: "Project One",
                workspaceRoot: "/workspace/project-1",
                threadId,
                threadTitle: "Original title",
              },
            },
          },
        });
        return yield* broker.bindSession({ threadId });
      }).pipe(Effect.provide(makeBrokerLayer(orchestrationMock))),
    );

    expect(binding?.listServers()).toEqual([
      expect.objectContaining({
        tools: {
          "t3work.view.read": expect.objectContaining({ title: "Read current t3work view" }),
        },
      }),
    ]);
  });
});
