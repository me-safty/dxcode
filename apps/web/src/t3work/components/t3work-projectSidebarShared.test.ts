import { describe, expect, it } from "vite-plus/test";

import {
  formatSleepingUntil,
  resolveProjectStatusIndicator,
  resolveThreadStatusPill,
} from "./t3work-projectSidebarShared";
import type { ProjectThread } from "~/t3work/t3work-types";

/** A minimal ProjectThread with just the fields the status pill reads. */
function makeThread(overrides: Partial<ProjectThread>): ProjectThread {
  return {
    id: "t1",
    projectId: "p1",
    title: "Weekly triage",
    messageCount: 0,
    lastMessageAt: "2026-06-14T00:00:00.000Z",
    createdAt: "2026-06-14T00:00:00.000Z",
    status: "idle",
    ...overrides,
  };
}

describe("resolveThreadStatusPill — sleeping (Epic 27)", () => {
  it("renders a clock-parked routine as 'Sleeping until <time>'", () => {
    const pill = resolveThreadStatusPill(
      makeThread({ status: "idle", sleepingUntil: "2026-06-15T09:00:00.000Z" }),
    );
    expect(pill?.label).toBe("Sleeping");
    expect(pill?.pulse).toBe(false);
    expect(pill?.detail).toMatch(/^until .*\d{1,2}:\d{2}/); // "until <weekday> HH:MM"
  });

  it("prefers the sleeping pill over the derived run status while parked", () => {
    // Even if a stale run status lingers, a set wake instant means the thread is dormant.
    const pill = resolveThreadStatusPill(
      makeThread({ status: "running", sleepingUntil: "2026-06-15T09:00:00.000Z" }),
    );
    expect(pill?.label).toBe("Sleeping");
  });

  it("falls back to the run status when no wake instant is set", () => {
    expect(resolveThreadStatusPill(makeThread({ status: "running" }))?.label).toBe("Working");
    expect(resolveThreadStatusPill(makeThread({ status: "idle" }))).toBeNull();
  });

  it("ranks a sleeping thread in the project status rollup", () => {
    const indicator = resolveProjectStatusIndicator([
      makeThread({ id: "a", status: "idle" }),
      makeThread({ id: "b", status: "idle", sleepingUntil: "2026-06-15T09:00:00.000Z" }),
    ]);
    expect(indicator?.label).toBe("Sleeping");
  });
});

describe("formatSleepingUntil", () => {
  it("renders an 'until <time>' phrase for a valid wake instant", () => {
    const detail = formatSleepingUntil("2026-06-15T09:00:00.000Z");
    expect(detail.startsWith("until ")).toBe(true);
    expect(detail).toMatch(/\d{1,2}:\d{2}/);
  });

  it("degrades gracefully for an unparseable instant", () => {
    expect(formatSleepingUntil("not-a-date")).toBe("until later");
  });
});
