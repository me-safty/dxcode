import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { ApprovalGate } from "../Services/ApprovalGate.ts";
import {
  DurableApprovalResume,
  type DurableApprovalResumeShape,
} from "../Services/DurableApprovalResume.ts";
import { WorkflowEventStoreError } from "../Services/Errors.ts";

interface PendingWaitRow {
  readonly providerRequestId: string | null;
  readonly providerThreadId: string | null;
  readonly stepRunId: string;
}

const toResumeError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

const wrapSql = <A>(effect: Effect.Effect<A, SqlError>) =>
  effect.pipe(Effect.mapError(toResumeError("approval resume sql failed")));

const make = Effect.gen(function* () {
  const approvals = yield* ApprovalGate;
  const sql = yield* SqlClient.SqlClient;

  const resume: DurableApprovalResumeShape["resume"] = () =>
    Effect.gen(function* () {
      const pendingWaits = yield* wrapSql(sql<PendingWaitRow>`
        SELECT
          json_extract(await.payload_json, '$.providerRequestId') AS "providerRequestId",
          json_extract(await.payload_json, '$.providerThreadId') AS "providerThreadId",
          json_extract(await.payload_json, '$.stepRunId') AS "stepRunId"
        FROM p_workflow_boards_events AS await
        WHERE await.event_type = 'StepAwaitingUser'
          AND NOT EXISTS (
            SELECT 1
            FROM p_workflow_boards_events AS resolved
            WHERE resolved.event_type = 'StepUserResolved'
              AND json_extract(resolved.payload_json, '$.stepRunId')
                = json_extract(await.payload_json, '$.stepRunId')
          )
        ORDER BY await.sequence ASC
      `);

      for (const pending of pendingWaits) {
        // provider-backed dispatch recovery is owned by WorkflowAgentPort.recoverPending (A2);
        // this handles only human approval-step parks.
        if (!(pending.providerThreadId && pending.providerRequestId)) {
          yield* approvals.park(pending.stepRunId as never);
        }
      }
    });

  return { resume } satisfies DurableApprovalResumeShape;
});

export const DurableApprovalResumeLive = Layer.effect(DurableApprovalResume, make);
