import type { UpstreamSyncSession, UpstreamUpdateState } from "@t3tools/contracts";

export interface UpstreamPillView {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly dismissible: boolean;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export function upstreamPillView(state: UpstreamUpdateState | null): UpstreamPillView | null {
  if (state?.status === "available") {
    return {
      key: `${state.target.tag}:${state.target.commit}`,
      title: "T3 nightly available",
      description: `${state.target.tag} · ${state.commitCount} commits`,
      dismissible: true,
    };
  }
  if (state?.status === "session-active") {
    return {
      key: `session:${state.session.id}:${state.newerTarget?.tag ?? "current"}`,
      title:
        state.session.status === "recoverable"
          ? "Resume T3 synchronization"
          : `Syncing ${compactNightlyTag(state.session.target.tag)}`,
      description: state.newerTarget
        ? `A newer nightly ${compactNightlyTag(state.newerTarget.tag)} is waiting.`
        : `${state.session.branch} · ${state.session.status}`,
      dismissible: false,
    };
  }
  return null;
}

export function compactNightlyTag(tag: string): string {
  const build = /\.(\d+)$/.exec(tag)?.[1];
  return build ? `.${build}` : tag;
}

export function groupedNightlyLabel(count: number): string {
  return `${count} newer nightly ${count === 1 ? "tag" : "tags"}`;
}

export function conflictDecisionRows(session: UpstreamSyncSession): ReadonlyArray<{
  readonly file: string;
  readonly upstream: string;
  readonly dx: string;
  readonly suggestion: string;
}> {
  const files = new Set([...session.comparison.overlappingFiles, ...session.conflictFiles]);
  return [...files].map((file) => ({
    file,
    upstream: "Changed upstream",
    dx: session.comparison.overlappingFiles.includes(file) ? "Changed in DX" : "No DX overlap",
    suggestion: session.conflictFiles.includes(file)
      ? "Resolve behavior conflict"
      : "Review semantic overlap",
  }));
}
