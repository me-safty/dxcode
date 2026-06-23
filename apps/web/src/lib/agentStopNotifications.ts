import type { OrchestrationSessionStatus } from "@t3tools/contracts";

export type AgentStopSoundSource = "tone" | "system";
export type AgentStopStatusLabel = "finished" | "awaiting input" | "errored";

export interface AgentStopNotifySettings {
  readonly popup: boolean;
  readonly sound: boolean;
  readonly soundSource: AgentStopSoundSource;
}

/** Structural subset of EnvironmentThreadShell needed to decide notifications. */
export interface ThreadShellLike {
  readonly id: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly title: string;
  readonly session: { readonly status: OrchestrationSessionStatus } | null;
  readonly hasPendingUserInput: boolean;
  readonly hasPendingApprovals: boolean;
}

/** Structural subset of EnvironmentProject needed to resolve a project name. */
export interface ProjectLike {
  readonly id: string;
  readonly title: string;
}

export interface AgentStopNotification {
  readonly threadId: string;
  readonly environmentId: string;
  readonly title: string;
  readonly body: string;
  readonly status: AgentStopStatusLabel;
}

export interface AgentStopDecisionInput {
  readonly prevStatuses: ReadonlyMap<string, OrchestrationSessionStatus>;
  readonly threads: readonly ThreadShellLike[];
  readonly projects: readonly ProjectLike[];
  readonly settings: AgentStopNotifySettings;
  readonly activeThreadId: string | null;
  readonly isAppFocused: boolean;
}

export interface AgentStopDecisionResult {
  readonly notifications: AgentStopNotification[];
  readonly nextStatuses: Map<string, OrchestrationSessionStatus>;
}

// Statuses that count as an agent finishing/erroring (vs. a user-initiated
// stop/interrupt, which surfaces as "stopped"/"interrupted" and is excluded here).
//
// KNOWN LIMITATION: a user *turn interrupt* (the chat stop button) does NOT
// surface as "interrupted" in the shell snapshot. The provider-ingestion layer
// maps an interrupted `turn.completed` to session status "ready" (only "failed"
// is special-cased — see apps/server/.../ProviderRuntimeIngestion.ts), and the
// projector derives latestTurn.state "completed" from that "ready". So an
// interrupted turn is indistinguishable from a natural completion here, and the
// observer fires a false "finished" notification when a user interrupts a thread
// they are NOT currently viewing (foreground + focused interrupts are suppressed
// by the active-thread check). The correct fix is upstream: record interrupted/
// cancelled turns as session status "interrupted" (or surface the real turn
// outcome in the shell), then gate on it here. Tracked as a follow-up.
//
// Do NOT "fix" this by removing "ready" from this set: natural completions also
// land on "ready", so dropping it would suppress the legitimate notification.
const STOP_STATUSES: ReadonlySet<OrchestrationSessionStatus> = new Set([
  "idle",
  "ready",
  "error",
]);

function statusLabel(thread: ThreadShellLike): AgentStopStatusLabel {
  if (thread.session?.status === "error") return "errored";
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "awaiting input";
  return "finished";
}

/**
 * Pure decision core. Given the previously-seen per-thread statuses and the
 * current shell snapshot, returns the notifications to emit and the new
 * status map. Fires once on a `running -> idle/ready/error` edge per thread;
 * never on first sighting (baseline), never on user-initiated stop/interrupt,
 * and never when the user is already focused on that exact thread.
 * `nextStatuses` is always fully rebuilt so removed threads drop out.
 */
export function decideAgentStopNotifications(
  input: AgentStopDecisionInput,
): AgentStopDecisionResult {
  const nextStatuses = new Map<string, OrchestrationSessionStatus>();
  const notifications: AgentStopNotification[] = [];

  for (const thread of input.threads) {
    const status = thread.session?.status;
    if (status === undefined) continue; // no session -> not tracked
    nextStatuses.set(thread.id, status);

    const prev = input.prevStatuses.get(thread.id);
    const transitioned = prev === "running" && STOP_STATUSES.has(status);
    if (!transitioned) continue;

    if (!input.settings.popup && !input.settings.sound) continue;
    if (input.isAppFocused && input.activeThreadId === thread.id) continue;

    const projectName =
      input.projects.find((p) => p.id === thread.projectId)?.title ?? "Unknown project";
    const label = statusLabel(thread);
    notifications.push({
      threadId: thread.id,
      environmentId: thread.environmentId,
      title: thread.title,
      body: `${projectName} · ${label}`,
      status: label,
    });
  }

  return { notifications, nextStatuses };
}
