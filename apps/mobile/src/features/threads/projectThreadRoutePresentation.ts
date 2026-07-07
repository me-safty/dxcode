import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { type EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

export type ThreadRoutePresentation = "content" | "loading" | "unavailable";

export function projectThreadRoutePresentation(input: {
  readonly hasSelectedThread: boolean;
  readonly isLoadingConnections: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly routeThreadStatus: EnvironmentThreadStatus;
  readonly routeThreadError: string | null;
}): ThreadRoutePresentation {
  if (input.hasSelectedThread) {
    return "content";
  }

  if (input.isLoadingConnections) {
    return "loading";
  }

  if (input.connectionState === "connecting" || input.connectionState === "reconnecting") {
    return "loading";
  }

  if (input.routeThreadStatus === "deleted" || input.routeThreadError !== null) {
    return "unavailable";
  }

  if (
    input.connectionState === "connected" ||
    input.connectionState === "available" ||
    input.routeThreadStatus === "synchronizing" ||
    input.routeThreadStatus === "cached" ||
    input.routeThreadStatus === "live"
  ) {
    return "loading";
  }

  return "unavailable";
}
