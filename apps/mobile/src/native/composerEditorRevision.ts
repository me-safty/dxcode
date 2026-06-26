export interface ComposerNativeEventSnapshot {
  readonly eventCount: number;
  readonly value: string;
}

export function acknowledgeComposerNativeEvent(
  mostRecentEventCount: number,
  incomingEventCount: number,
): number | null {
  if (!Number.isSafeInteger(incomingEventCount) || incomingEventCount < mostRecentEventCount) {
    return null;
  }
  return incomingEventCount;
}

export function resolveComposerControlledEventCount(
  value: string,
  mostRecentEventCount: number,
  snapshots: ReadonlyArray<ComposerNativeEventSnapshot>,
): number {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot?.value === value) {
      return snapshot.eventCount;
    }
  }

  return mostRecentEventCount;
}
