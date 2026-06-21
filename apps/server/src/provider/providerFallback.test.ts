import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { ProviderAdapterRequestError } from "./Errors.ts";
import {
  classifyProviderRuntimeFailure,
  classifyProviderServiceFailure,
  planProviderFallback,
} from "./providerFallback.ts";

const provider = (input: {
  id: string;
  models?: ReadonlyArray<string>;
  continuation?: string;
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(input.id),
  driver: ProviderDriverKind.make("codex"),
  displayName: input.id,
  ...(input.continuation ? { continuation: { groupKey: input.continuation } } : {}),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", type: "test" },
  checkedAt: "2026-06-21T00:00:00.000Z",
  models: (input.models ?? ["gpt-5"]).map((slug) => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: null,
  })),
  slashCommands: [],
  skills: [],
});

const settings = {
  providerFallback: { enabled: true },
  providerInstances: {},
} as ServerSettings;

describe("planProviderFallback", () => {
  it("preserves provider order and explains model and continuation skips", () => {
    const plan = planProviderFallback({
      settings,
      providers: [
        provider({ id: "codex", continuation: "home:a" }),
        provider({ id: "codex_missing", models: ["gpt-4"], continuation: "home:a" }),
        provider({ id: "codex_other_home", continuation: "home:b" }),
        provider({ id: "codex_work", continuation: "home:a" }),
      ],
      currentInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      requireCompatibleContinuation: true,
    });

    expect(plan.candidates.map((entry) => entry.instanceId)).toEqual(["codex_work"]);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual([
      "Model 'gpt-5' was not found on this instance.",
      "The provider home directory or continuation store does not match the active instance.",
    ]);
  });

  it("defaults instance participation on and excludes explicitly opted-out instances", () => {
    const plan = planProviderFallback({
      settings: {
        ...settings,
        providerInstances: {
          [ProviderInstanceId.make("codex_disabled")]: {
            driver: ProviderDriverKind.make("codex"),
            allowFallback: false,
          },
        },
      },
      providers: [
        provider({ id: "codex" }),
        provider({ id: "codex_enabled" }),
        provider({ id: "codex_disabled" }),
      ],
      currentInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      requireCompatibleContinuation: false,
    });

    expect(plan.candidates.map((entry) => entry.instanceId)).toEqual(["codex_enabled"]);
    expect(plan.skipped[0]?.reason).toBe("Automatic fallback is disabled for this instance.");
  });
});

describe("provider fallback failure classification", () => {
  it("accepts operational failures and rejects unrelated provider errors", () => {
    const rateLimit = new ProviderAdapterRequestError({
      provider: "codex",
      method: "turn/start",
      detail: "Usage limit reached for this account.",
    });
    const invalidPrompt = new ProviderAdapterRequestError({
      provider: "codex",
      method: "turn/start",
      detail: "Prompt is invalid.",
    });

    expect(classifyProviderServiceFailure(Cause.fail(rateLimit))?.kind).toBe("rate-limit");
    expect(classifyProviderServiceFailure(Cause.fail(invalidPrompt))).toBeUndefined();
  });

  it("classifies canonical transport errors without parsing provider-specific details", () => {
    expect(
      classifyProviderRuntimeFailure({
        type: "runtime.error",
        eventId: EventId.make("event-1"),
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-21T00:00:00.000Z",
        payload: { message: "Disconnected", class: "transport_error" },
      })?.kind,
    ).toBe("transport");
  });
});
