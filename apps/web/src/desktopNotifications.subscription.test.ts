import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { subscribeDesktopNotificationEnvironment } from "./desktopNotifications.subscription";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

const BASE_THREAD = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:02.000Z",
  archivedAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
} as const;

function makeTurn(state: "running" | "completed") {
  return {
    turnId: TURN_ID,
    state,
    requestedAt: "2026-07-14T10:00:00.000Z",
    startedAt: "2026-07-14T10:00:01.000Z",
    completedAt: state === "running" ? null : "2026-07-14T10:00:02.000Z",
    assistantMessageId: null,
  };
}

function makeSession(state: "running" | "completed") {
  return {
    threadId: THREAD_ID,
    status: state === "running" ? ("running" as const) : ("ready" as const),
    providerName: "Codex",
    runtimeMode: "full-access" as const,
    activeTurnId: state === "running" ? TURN_ID : null,
    lastError: null,
    updatedAt: "2026-07-14T10:00:02.000Z",
  };
}

function makeThread(state: "idle" | "running" | "completed"): OrchestrationThreadShell {
  if (state === "idle") return { ...BASE_THREAD, latestTurn: null, session: null };
  return { ...BASE_THREAD, latestTurn: makeTurn(state), session: makeSession(state) };
}

function makeShell(thread: OrchestrationThreadShell): EnvironmentShellState {
  return {
    snapshot: Option.some({
      snapshotSequence: 1,
      updatedAt: thread.updatedAt,
      projects: [],
      threads: [thread],
    }),
    status: "live",
    error: Option.none(),
    baselineRevision: 1,
  };
}

describe("desktop notification subscription", () => {
  it("subscribe_backToBackTurnUpdates_observesRunningTransition", () => {
    const shellAtom = Atom.make(makeShell(makeThread("idle")));
    const registry = AtomRegistry.make();
    const deliver = vi.fn();
    const unsubscribe = subscribeDesktopNotificationEnvironment({
      registry,
      shellAtom,
      environmentId: ENVIRONMENT_ID,
      generation: 1,
      deliver,
    });

    registry.set(shellAtom, makeShell(makeThread("running")));
    registry.set(shellAtom, makeShell(makeThread("completed")));

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn-completed" }));
    unsubscribe();
    registry.dispose();
  });
});
