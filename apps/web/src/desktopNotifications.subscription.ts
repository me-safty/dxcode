import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { DesktopNotificationEvent, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE,
  reduceDesktopNotificationObservation,
} from "./desktopNotifications.logic";

interface DesktopNotificationSubscriptionOptions {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly shellAtom: Atom.Atom<EnvironmentShellState>;
  readonly environmentId: EnvironmentId;
  readonly generation: number;
  readonly deliver: (event: DesktopNotificationEvent) => void;
}

function readThreads(shell: EnvironmentShellState) {
  return Option.match(shell.snapshot, {
    onNone: () => [],
    onSome: (snapshot) => snapshot.threads,
  });
}

export function subscribeDesktopNotificationEnvironment(
  options: DesktopNotificationSubscriptionOptions,
): () => void {
  let tracker = EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE;
  return options.registry.subscribe(
    options.shellAtom,
    (shell) => {
      const reduction = reduceDesktopNotificationObservation(tracker, {
        active: shell.status === "live",
        syncKey: `${options.generation}:${shell.baselineRevision}`,
        environmentId: options.environmentId,
        threads: readThreads(shell),
      });
      tracker = reduction.state;
      for (const event of reduction.events) options.deliver(event);
    },
    { immediate: true },
  );
}
