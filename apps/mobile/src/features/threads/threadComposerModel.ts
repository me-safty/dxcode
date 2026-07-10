import type { RemoteClientConnectionState } from "../../lib/connection";

export type ThreadComposerSendLabel = "Queue" | "Send" | "Steer";

export function resolveThreadComposerSendLabel(input: {
  readonly connectionState: RemoteClientConnectionState;
  readonly activeThreadBusy: boolean;
  readonly queueCount: number;
  readonly queuedRunCount: number;
}): ThreadComposerSendLabel {
  // A send joins the backlog when the client is offline, local outbox
  // messages are waiting, or the server has already queued runs.
  if (input.connectionState !== "connected" || input.queueCount > 0 || input.queuedRunCount > 0) {
    return "Queue";
  }
  return input.activeThreadBusy ? "Steer" : "Send";
}
