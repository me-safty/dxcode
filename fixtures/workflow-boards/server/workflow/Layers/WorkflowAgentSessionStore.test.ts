import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardId, LaneKey, TicketId } from "../../../contracts/workflow.ts";
import { TestSql } from "../testHarness.ts";
import { WorkflowAgentSessionStore } from "../Services/WorkflowAgentSessionStore.ts";
import { WorkflowAgentSessionStoreLive } from "./WorkflowAgentSessionStore.ts";

const layer = it.layer(WorkflowAgentSessionStoreLive.pipe(Layer.provideMerge(TestSql)));

layer("WorkflowAgentSessionStore", (it) => {
  it.effect("upsert preserves thread_id and bumps last_used_at", () =>
    Effect.gen(function* () {
      const store = yield* WorkflowAgentSessionStore;
      const ticketId = TicketId.make("ticket-session");
      const laneKey = LaneKey.make("lane-build");

      yield* store.upsert(ticketId, laneKey, "agent-key", "thread-original");
      const firstRows = yield* store.listByTicket(ticketId);
      yield* store.upsert(ticketId, laneKey, "agent-key", "thread-replacement");

      const threadId = yield* store.getThreadId(ticketId, laneKey, "agent-key");
      const rows = yield* store.listByTicket(ticketId);

      assert.equal(threadId, "thread-original");
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.threadId, "thread-original");
      assert.equal(rows[0]?.createdAt, firstRows[0]?.createdAt);
      assert.ok((rows[0]?.lastUsedAt ?? "") >= (firstRows[0]?.lastUsedAt ?? ""));
    }),
  );

  it.effect("lists and deletes sessions by ticket or board", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkflowAgentSessionStore;
      const boardId = BoardId.make("board-session");
      const otherBoardId = BoardId.make("board-other");
      const ticketId = TicketId.make("ticket-session-board");
      const otherTicketId = TicketId.make("ticket-session-other");
      const now = "2026-07-03T00:00:00.000Z";

      yield* sql`
        INSERT INTO p_workflow_boards_projection_ticket
          (ticket_id, board_id, title, current_lane_key, status, created_at, updated_at)
        VALUES
          (${String(ticketId)}, ${String(boardId)}, 'Ticket', 'lane-build', 'running', ${now}, ${now}),
          (${String(otherTicketId)}, ${String(otherBoardId)}, 'Other', 'lane-build', 'running', ${now}, ${now})
      `;
      yield* store.upsert(ticketId, LaneKey.make("lane-build"), "agent-key", "thread-board");
      yield* store.upsert(otherTicketId, LaneKey.make("lane-build"), "agent-key", "thread-other");

      const boardRows = yield* store.listByBoard(boardId);
      assert.deepEqual(
        boardRows.map((row) => row.threadId),
        ["thread-board"],
      );

      yield* store.deleteByBoard(boardId);
      assert.equal(
        yield* store.getThreadId(ticketId, LaneKey.make("lane-build"), "agent-key"),
        null,
      );
      assert.equal(
        yield* store.getThreadId(otherTicketId, LaneKey.make("lane-build"), "agent-key"),
        "thread-other",
      );

      yield* store.deleteByTicket(otherTicketId);
      assert.equal(
        yield* store.getThreadId(otherTicketId, LaneKey.make("lane-build"), "agent-key"),
        null,
      );
    }),
  );
});
