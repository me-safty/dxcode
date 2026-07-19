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

export function replaceQueuedMessage<T extends { readonly id: string; readonly threadKey: string }>(
  queue: ReadonlyArray<T>,
  input: {
    readonly id: string;
    readonly threadKey: string;
    readonly replacement: T | null;
  },
): { readonly message: T | null; readonly queue: T[] } {
  const index = queue.findIndex(
    (entry) => entry.id === input.id && entry.threadKey === input.threadKey,
  );
  if (index < 0) {
    return { message: null, queue: [...queue] };
  }
  const message = queue[index] ?? null;
  return {
    message,
    queue: [
      ...queue.slice(0, index),
      ...(input.replacement ? [input.replacement] : []),
      ...queue.slice(index + 1),
    ],
  };
}
