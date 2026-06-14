/**
 * Resolve-input value checks (Epic 25 §askUser decision cards): a structured value must fit the
 * pending ask's affordance and the card's correlationId must still be the pending one; freeform
 * text (no value) is never blocked. Display text falls back from the provided text to the value.
 */

import { describe, expect, it } from "vite-plus/test";

import type { WorkflowPendingAsk } from "./t3work-workflowEngineRegistry.ts";
import {
  rejectWorkflowResolveValue,
  workflowReplyDisplayText,
} from "./t3work-workflowResolveInput.ts";

const choicePending: WorkflowPendingAsk = {
  runId: "run-1",
  correlationId: "run-1:1",
  kind: "user.input",
  affordance: { kind: "choice", options: ["ship-now", "hold"] },
};

const fieldedPending: WorkflowPendingAsk = {
  runId: "run-1",
  correlationId: "run-1:1",
  kind: "user.input",
  affordance: { kind: "choice", field: "severity", options: ["low", "high"] },
};

describe("rejectWorkflowResolveValue", () => {
  it("accepts an offered choice", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: choicePending,
        correlationId: "run-1:1",
        hasValue: true,
        value: "hold",
      }),
    ).toBeNull();
  });

  it("rejects a value outside the offered choices", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: choicePending,
        correlationId: undefined,
        hasValue: true,
        value: "merge-later",
      }),
    ).toMatch(/does not match the offered choices/);
  });

  it("accepts a fielded choice submitted as { field: option } and rejects other shapes", () => {
    const base = { pending: fieldedPending, correlationId: undefined, hasValue: true };
    expect(rejectWorkflowResolveValue({ ...base, value: { severity: "high" } })).toBeNull();
    expect(rejectWorkflowResolveValue({ ...base, value: "high" })).not.toBeNull();
    expect(rejectWorkflowResolveValue({ ...base, value: { severity: "high", extra: 1 } })).not.toBeNull();
    expect(rejectWorkflowResolveValue({ ...base, value: { severity: "medium" } })).not.toBeNull();
  });

  it("rejects a stale correlationId (the card's ask is no longer pending)", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: choicePending,
        correlationId: "run-1:7",
        hasValue: true,
        value: "hold",
      }),
    ).toMatch(/no longer pending/);
    expect(
      rejectWorkflowResolveValue({
        pending: undefined,
        correlationId: "run-1:1",
        hasValue: true,
        value: "hold",
      }),
    ).toMatch(/no longer pending/);
  });

  it("rejects a structured value when no user input is pending", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: undefined,
        correlationId: undefined,
        hasValue: true,
        value: "hold",
      }),
    ).toMatch(/No workflow input is pending/);
    expect(
      rejectWorkflowResolveValue({
        pending: { runId: "run-1", correlationId: "run-1:2", kind: "thread.turn" },
        correlationId: undefined,
        hasValue: true,
        value: "hold",
      }),
    ).toMatch(/No workflow input is pending/);
  });

  it("passes a structured value through when the affordance is unknown (post-restart; SDK validates on resume)", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: { runId: "run-1", correlationId: "run-1:1", kind: "user.input" },
        correlationId: undefined,
        hasValue: true,
        value: { anything: true },
      }),
    ).toBeNull();
  });

  it("rejects a structured value on a known text ask (no schemaless body should see a non-string)", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: {
          runId: "run-1",
          correlationId: "run-1:1",
          kind: "user.input",
          affordance: { kind: "text" },
        },
        correlationId: undefined,
        hasValue: true,
        value: { foo: "bar" },
      }),
    ).toMatch(/freeform text reply/);
  });

  it("never blocks a freeform text reply (no value posted)", () => {
    expect(
      rejectWorkflowResolveValue({
        pending: choicePending,
        correlationId: undefined,
        hasValue: false,
        value: undefined,
      }),
    ).toBeNull();
    expect(
      rejectWorkflowResolveValue({
        pending: undefined,
        correlationId: undefined,
        hasValue: false,
        value: undefined,
      }),
    ).toBeNull();
  });
});

describe("workflowReplyDisplayText", () => {
  it("prefers the provided text, then a string value, then JSON", () => {
    expect(workflowReplyDisplayText("hold", "Hold for now")).toBe("Hold for now");
    expect(workflowReplyDisplayText("hold", "")).toBe("hold");
    expect(workflowReplyDisplayText({ severity: "high" }, "")).toBe('{"severity":"high"}');
  });
});
