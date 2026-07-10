import type { RemoteClientConnectionState } from "../../lib/connection";

export type ThreadComposerSendLabel = "Queue" | "Send" | "Steer";

export function resolveThreadComposerSendLabel(input: {
  readonly connectionState: RemoteClientConnectionState;
  readonly activeThreadBusy: boolean;
  readonly queueCount: number;
}): ThreadComposerSendLabel {
  if (input.connectionState !== "connected" || input.queueCount > 0) {
    return "Queue";
  }
  return input.activeThreadBusy ? "Steer" : "Send";
}
