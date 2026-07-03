import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** A needs-you attention transition the committer would have enqueued for push. */
export interface NotificationAttention {
  readonly ticketId: string;
  readonly boardId: string;
  readonly sequence: number;
  readonly status: string;
  readonly prevStatus: string | null;
  readonly attentionKind: string | null;
  readonly attentionReason: string | null;
}

export interface NotificationSinkShape {
  /**
   * Called from WorkflowEventCommitter INSIDE the commit `sql.withTransaction`
   * boundary. The no-op adapter is inert, but a future REAL adapter must NOT do
   * network/push I/O here: it would hold the DB transaction open during I/O and
   * would not be rolled back if a later in-transaction step fails. A real sink
   * should durably ENQUEUE (e.g. its own outbox row in the same transaction) and
   * deliver from a separate dispatcher — exactly what the fork's
   * `workflow_notification_outbox` + dispatcher did.
   */
  readonly notifyAttention: (input: NotificationAttention) => Effect.Effect<void>;
}

export class NotificationSink extends Context.Service<NotificationSink, NotificationSinkShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/NotificationSink",
) {}

/** v1: notifications dropped. A future slice can add a real adapter. */
export const NotificationSinkNoop = Layer.succeed(NotificationSink, {
  notifyAttention: () => Effect.void,
});
