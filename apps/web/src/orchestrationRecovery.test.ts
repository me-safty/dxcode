import { describe, expect, it } from "vitest";

import { createOrchestrationRecoveryCoordinator } from "./orchestrationRecovery";

describe("createOrchestrationRecoveryCoordinator", () => {
  it("defers live events until bootstrap completes and then requests replay", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.classifyDomainEvent(4)).toBe("defer");

    expect(coordinator.completeSnapshotRecovery(2)).toBe(true);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 2,
      highestObservedSequence: 4,
      bootstrapped: true,
      pendingReplay: false,
      inFlight: null,
    });
  });

  it("classifies sequence gaps as recovery-only replay work", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.classifyDomainEvent(5)).toBe("recover");
    expect(coordinator.beginReplayRecovery("sequence-gap")).toBe(true);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "replay",
      reason: "sequence-gap",
    });
  });

  it("tracks live event batches without entering recovery", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.classifyDomainEvent(4)).toBe("apply");
    expect(coordinator.markEventBatchApplied([{ sequence: 4 }])).toEqual([{ sequence: 4 }]);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 4,
      highestObservedSequence: 4,
      bootstrapped: true,
      inFlight: null,
    });
  });

  it("requests another replay when deferred events arrive during replay recovery", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    coordinator.classifyDomainEvent(5);
    coordinator.beginReplayRecovery("sequence-gap");
    coordinator.classifyDomainEvent(7);
    coordinator.markEventBatchApplied([{ sequence: 4 }, { sequence: 5 }, { sequence: 6 }]);

    expect(coordinator.completeReplayRecovery()).toBe(true);
  });

  it("marks replay failure as unbootstrapped so snapshot fallback is recovery-only", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);
    coordinator.beginReplayRecovery("sequence-gap");
    coordinator.failReplayRecovery();

    expect(coordinator.getState()).toMatchObject({
      bootstrapped: false,
      inFlight: null,
    });
    expect(coordinator.beginSnapshotRecovery("replay-failed")).toBe(true);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "snapshot",
      reason: "replay-failed",
    });
  });
});
