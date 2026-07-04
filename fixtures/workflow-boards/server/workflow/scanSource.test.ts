import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { WorkflowSourceConfig } from "../../contracts/workflow.ts";
import {
  chunkArray,
  MAX_DELTAS_PER_RECONCILE_CHUNK,
  MAX_ITEMS_PER_SOURCE_TICK,
  scanSource,
} from "./scanSource.ts";
import type {
  ExternalWorkItem,
  WorkSourcePage,
  WorkSourceProvider,
} from "./Services/WorkSourceProvider.ts";

const item = (id: string): ExternalWorkItem => ({
  provider: "github",
  externalId: id,
  url: `https://example.test/${id}`,
  lifecycle: "open",
  version: {},
  fields: { title: id },
});

const stubProvider = (pages: Array<WorkSourcePage>): WorkSourceProvider => ({
  provider: "github",
  selectorSchema: {} as never,
  listPage: () => Effect.succeed(pages.shift() ?? { items: [] }),
  getItem: () => Effect.succeed(null),
  viewer: () => Effect.succeed(null),
  toImportableView: () => ({ displayRef: "", container: "" }),
});

const source = {
  id: "source-1",
  provider: "github",
  connectionRef: "conn",
  selector: { owner: "acme", repo: "widgets" },
  destinationLane: "inbox",
  closedLane: "done",
  enabled: true,
} as unknown as WorkflowSourceConfig;

describe("scanSource", () => {
  it.effect("paginates provider.listPage until no nextPageToken remains", () =>
    Effect.gen(function* () {
      const result = yield* scanSource(
        stubProvider([{ items: [item("1")], nextPageToken: "2" }, { items: [item("2")] }]),
        source,
        "2024-01-01T00:00:00Z",
      );

      assert.deepEqual(
        result.items.map((i) => i.externalId),
        ["1", "2"],
      );
      assert.equal(result.scanCompleted, true);
    }),
  );

  it.effect("marks the scan partial when the item cap is hit while more pages remain", () =>
    Effect.gen(function* () {
      const big = Array.from({ length: MAX_ITEMS_PER_SOURCE_TICK }, (_, index) =>
        item(String(index)),
      );
      const result = yield* scanSource(
        stubProvider([{ items: big, nextPageToken: "more" }, { items: [item("tail")] }]),
        source,
        undefined,
      );

      assert.equal(result.items.length, MAX_ITEMS_PER_SOURCE_TICK);
      assert.equal(result.scanCompleted, false);
    }),
  );
});

describe("chunkArray", () => {
  it("splits arrays by the requested chunk size", () => {
    const chunks = chunkArray(
      Array.from({ length: MAX_DELTAS_PER_RECONCILE_CHUNK + 1 }, (_, index) => index),
      MAX_DELTAS_PER_RECONCILE_CHUNK,
    );
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.length, MAX_DELTAS_PER_RECONCILE_CHUNK);
    assert.equal(chunks[1]!.length, 1);
  });
});
