import type { RunningMessageBehavior } from "@t3tools/contracts/settings";

export function resolveRunningMessageBehavior(input: {
  readonly defaultBehavior: RunningMessageBehavior;
  readonly steerShortcut: boolean;
}): RunningMessageBehavior {
  return input.steerShortcut ? "steer" : input.defaultBehavior;
}

export function shouldShowRunningStopAction(input: {
  readonly running: boolean;
  readonly hasSendableContent: boolean;
}): boolean {
  return input.running && !input.hasSendableContent;
}

export function takeNextQueuedMessageForThread<T extends { readonly threadKey: string }>(
  queue: ReadonlyArray<T>,
  threadKey: string,
): { readonly message: T | null; readonly remaining: T[] } {
  const index = queue.findIndex((entry) => entry.threadKey === threadKey);
  if (index < 0) {
    return { message: null, remaining: [...queue] };
  }
  return {
    message: queue[index] ?? null,
    remaining: [...queue.slice(0, index), ...queue.slice(index + 1)],
  };
}
