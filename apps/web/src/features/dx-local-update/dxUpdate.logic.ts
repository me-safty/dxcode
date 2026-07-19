import type { DxLocalUpdateState } from "@t3tools/contracts";

export interface DxUpdateSummary {
  readonly title: string;
  readonly description: string;
}

export function dxUpdateSummary(
  state: DxLocalUpdateState | null | undefined,
): DxUpdateSummary | null {
  if (!state) return null;
  if (state.status === "available") {
    const remote = state.reasons.find((reason) => reason.kind === "origin-dx-main");
    const nightly = state.reasons.find((reason) => reason.kind === "upstream-nightly");
    if (remote && nightly) {
      return {
        title: "DX + T3 updates available",
        description: `${remote.commitsBehind} DX commits · ${nightly.target.tag}`,
      };
    }
    if (remote) {
      return {
        title: "DX Code update available",
        description: `origin/dx/main is ${remote.commitsBehind} commits ahead`,
      };
    }
    if (nightly) {
      return { title: "T3 nightly available", description: nightly.target.tag };
    }
  }
  if (state.status === "reviewing") {
    return { title: "Review DX update", description: `Syncing ${state.session.target.tag}` };
  }
  if (state.status === "awaiting-publish") {
    return { title: "DX update verified", description: "Ready to publish and build" };
  }
  if (state.status === "publishing" || state.status === "building") {
    return { title: "Updating DX Code", description: state.phase };
  }
  if (state.status === "awaiting-install") {
    return { title: "DX update built", description: "Ready to install and restart" };
  }
  if (state.status === "installing" || state.status === "restart-pending") {
    return { title: "Installing DX Code", description: "Restart pending" };
  }
  return null;
}
