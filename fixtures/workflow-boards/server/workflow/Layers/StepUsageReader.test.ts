import { assert, it } from "@effect/vitest";
import { EventId, type OrchestrationThreadActivity, type ThreadId } from "@t3tools/contracts";
import type { ProjectionsReadCapability } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkflowProjectionsReadCapability } from "../Services/WorkflowAgentPort.ts";
import { StepUsageReader } from "../Services/StepUsageReader.ts";
import { StepUsageReaderLive } from "./StepUsageReader.ts";

class ProjectionReadError extends Error {
  readonly _tag = "ProjectionReadError";
}

const threadId = "thread-usage" as ThreadId;

const activity = (overrides: Partial<OrchestrationThreadActivity>): OrchestrationThreadActivity =>
  ({
    id: EventId.make("act-1"),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload: {},
    turnId: null,
    createdAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  }) as OrchestrationThreadActivity;

const projectionsWith = (
  rows: ReadonlyArray<OrchestrationThreadActivity>,
): ProjectionsReadCapability =>
  ({
    getThreadShellById: () => Effect.succeed(null),
    getThreadDetailById: () => Effect.succeed(null),
    listTurnsByThreadId: () => Effect.succeed([]),
    listMessagesByThreadId: () => Effect.succeed([]),
    getMessageById: () => Effect.succeed(null),
    listActivitiesByThreadId: () => Effect.succeed(rows),
  }) satisfies ProjectionsReadCapability;

const layerWith = (rows: ReadonlyArray<OrchestrationThreadActivity>) =>
  StepUsageReaderLive.pipe(
    Layer.provideMerge(Layer.succeed(WorkflowProjectionsReadCapability, projectionsWith(rows))),
  );

const readUsage = (rows: ReadonlyArray<OrchestrationThreadActivity>) =>
  Effect.gen(function* () {
    const reader = yield* StepUsageReader;
    return yield* reader.read(threadId);
  }).pipe(Effect.provide(layerWith(rows)));

it.effect("maps the latest context-window snapshot to workflow usage", () =>
  Effect.gen(function* () {
    const usage = yield* readUsage([
      activity({
        id: EventId.make("act-1"),
        payload: { usedTokens: 100, inputTokens: 80, outputTokens: 20 },
      }),
      activity({
        id: EventId.make("act-2"),
        payload: {
          usedTokens: 500,
          totalProcessedTokens: 1200,
          inputTokens: 900,
          cachedInputTokens: 300,
          outputTokens: 250,
        },
      }),
    ]);

    assert.deepEqual(usage, {
      inputTokens: 900,
      cachedInputTokens: 300,
      outputTokens: 250,
      totalTokens: 1200,
    });
  }),
);

it.effect("ignores other activity kinds and malformed payloads", () =>
  Effect.gen(function* () {
    const usage = yield* readUsage([
      activity({ id: EventId.make("act-1"), payload: { usedTokens: 42, inputTokens: 30 } }),
      activity({
        id: EventId.make("act-2"),
        kind: "tool.completed",
        payload: { usedTokens: 999999 },
      }),
      activity({ id: EventId.make("act-3"), payload: { usedTokens: "not-a-number" } }),
    ]);

    assert.deepEqual(usage, { inputTokens: 30, totalTokens: 42 });
  }),
);

it.effect("returns undefined when no usage was emitted", () =>
  Effect.gen(function* () {
    const usage = yield* readUsage([]);
    assert.equal(usage, undefined);
  }),
);

it.effect("returns undefined when projection activity reads fail", () =>
  Effect.gen(function* () {
    const projections = {
      ...projectionsWith([]),
      listActivitiesByThreadId: () =>
        Effect.fail(new ProjectionReadError("projection unavailable")),
    } satisfies ProjectionsReadCapability;

    const usage = yield* Effect.gen(function* () {
      const reader = yield* StepUsageReader;
      return yield* reader.read(threadId);
    }).pipe(
      Effect.provide(
        StepUsageReaderLive.pipe(
          Layer.provideMerge(Layer.succeed(WorkflowProjectionsReadCapability, projections)),
        ),
      ),
    );

    assert.equal(usage, undefined);
  }),
);
