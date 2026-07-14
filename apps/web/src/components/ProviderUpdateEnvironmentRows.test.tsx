import type { Dispatch, ReactElement, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  type EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import type {
  LocalEnvironmentUpdateGroup,
  ProviderUpdateCandidate,
  ProviderUpdateRowStatus,
} from "./ProviderUpdateLaunchNotification.logic";

const testState = vi.hoisted(() => ({
  groups: [] as LocalEnvironmentUpdateGroup[],
  isAnySettling: false,
  updateProvider: vi.fn(),
}));

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let slots: unknown[] = [];

  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      slots = [];
    },
    useCallback<T>(callback: T): T {
      nextIndex();
      return callback;
    },
    useMemo<T>(factory: () => T): T {
      nextIndex();
      return factory();
    },
    useEffect(effect: () => void | (() => void)): void {
      nextIndex();
      effect();
    },
    useMemoCache(size: number): unknown[] {
      const index = nextIndex();
      if (!slots[index]) {
        slots[index] = Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel"));
      }
      return slots[index] as unknown[];
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = nextIndex();
      if (!slots[index]) {
        slots[index] = { current: initialValue };
      }
      return slots[index] as { current: T };
    },
    useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = nextIndex();
      if (index >= slots.length) {
        slots[index] =
          typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
      }
      const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
        const previous = slots[index] as T;
        slots[index] =
          typeof nextValue === "function" ? (nextValue as (value: T) => T)(previous) : nextValue;
      };
      return [slots[index] as T, setValue];
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useMemo: hooks.useMemo,
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

vi.mock("react/compiler-runtime", () => ({
  c: hooks.useMemoCache,
}));

vi.mock("~/state/server", () => ({
  serverEnvironment: { updateProvider: Symbol("updateProvider") },
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => testState.updateProvider,
}));

vi.mock("./ProviderUpdateLaunchNotification.environments", () => ({
  useLocalEnvironmentUpdateGroups: () => ({
    groups: testState.groups,
    isAnySettling: testState.isAnySettling,
  }),
}));

import { ProviderUpdateEnvironmentRows } from "./ProviderUpdateEnvironmentRows";

const environmentId = "env-wsl" as EnvironmentId;
const pendingExpiryMs = 6 * 60_000;

function provider(updateStatus?: "succeeded"): ServerProvider {
  const result: ServerProvider = {
    instanceId: ProviderInstanceId.make("codex-wsl"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: updateStatus ? "1.1.0" : "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-26T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: updateStatus ? "current" : "behind_latest",
      currentVersion: updateStatus ? "1.1.0" : "1.0.0",
      latestVersion: "1.1.0",
      updateCommand: "npm install -g @openai/codex@latest",
      canUpdate: true,
      checkedAt: "2026-06-26T12:00:00.000Z",
      message: updateStatus ? "Up to date." : "Update available.",
    },
  };

  return updateStatus
    ? {
        ...result,
        updateState: {
          status: updateStatus,
          startedAt: "2026-06-26T12:00:00.000Z",
          finishedAt: "2026-06-26T12:00:01.000Z",
          message: "Provider updated.",
          output: null,
        },
      }
    : result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

type RowElement = ReactElement<{
  readonly status: ProviderUpdateRowStatus;
  readonly canUpdate: boolean;
  readonly onUpdate: () => void;
}>;

function renderRow(): RowElement {
  hooks.beginRender();
  const output = ProviderUpdateEnvironmentRows({}) as ReactElement<{
    readonly children: RowElement | RowElement[];
  }>;
  const children = output.props.children;
  return Array.isArray(children) ? children[0]! : children;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ProviderUpdateEnvironmentRows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.reset();
    testState.isAnySettling = false;
    testState.updateProvider.mockReset();
    const candidate = provider() as ProviderUpdateCandidate;
    testState.groups = [
      {
        environmentId,
        label: "WSL",
        isPrimary: false,
        connectionState: "ready",
        isSettling: false,
        candidates: [candidate],
        oneClickCandidates: [candidate],
        runnableCandidates: [candidate],
        providers: [candidate],
      },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not expose or dispatch an update for settings-only candidates", () => {
    testState.groups = testState.groups.map((group) => ({
      ...group,
      oneClickCandidates: [],
      runnableCandidates: [],
    }));

    const row = renderRow();

    expect(row.props.canUpdate).toBe(false);
    row.props.onUpdate();
    expect(testState.updateProvider).not.toHaveBeenCalled();
  });

  it("does not mark unattempted settings-only candidates as updated", async () => {
    const runnable = testState.groups[0]!.candidates[0]!;
    const settingsOnly = {
      ...provider(),
      instanceId: ProviderInstanceId.make("claude-wsl"),
      driver: ProviderDriverKind.make("claudeAgent"),
      versionAdvisory: {
        ...provider().versionAdvisory!,
        updateCommand: null,
        canUpdate: false,
      },
    } as ProviderUpdateCandidate;
    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [runnable, settingsOnly],
      oneClickCandidates: [runnable],
      runnableCandidates: [runnable],
      providers: [runnable, settingsOnly],
    }));
    testState.updateProvider.mockResolvedValue(
      AsyncResult.success({ providers: [provider("succeeded")] }),
    );

    renderRow().props.onUpdate();
    await flushPromises();

    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [settingsOnly],
      oneClickCandidates: [],
      runnableCandidates: [],
      providers: [settingsOnly],
    }));
    const row = renderRow();

    expect(row.props.status.kind).toBe("idle");
    expect(row.props.canUpdate).toBe(false);
  });

  it("shows sibling progress without allowing an idle representative to be redispatched", () => {
    const candidate = provider() as ProviderUpdateCandidate;
    const activeSibling = {
      ...provider(),
      instanceId: ProviderInstanceId.make("codex-work"),
      updateState: {
        status: "running" as const,
        startedAt: "2099-01-01T00:00:00.000Z",
        finishedAt: null,
        message: "Updating provider.",
        output: null,
      },
    } as ProviderUpdateCandidate;
    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [candidate],
      oneClickCandidates: [candidate],
      runnableCandidates: [],
      providers: [candidate, activeSibling],
    }));

    const row = renderRow();

    expect(row.props.status.kind).toBe("loading");
    expect(row.props.canUpdate).toBe(false);
  });

  it("does not let a sibling's success hide an outdated runnable target", () => {
    const candidate = provider() as ProviderUpdateCandidate;
    const successfulSibling = {
      ...provider("succeeded"),
      instanceId: ProviderInstanceId.make("codex-work"),
      updateState: {
        status: "succeeded" as const,
        startedAt: "2099-01-01T00:00:00.000Z",
        finishedAt: "2099-01-01T00:00:01.000Z",
        message: "Provider updated.",
        output: null,
      },
    };
    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [candidate],
      oneClickCandidates: [candidate],
      runnableCandidates: [candidate],
      providers: [successfulSibling, candidate],
    }));

    const row = renderRow();

    expect(row.props.status.kind).toBe("idle");
    expect(row.props.canUpdate).toBe(true);
  });

  it("hides a transport error after its attempted target is no longer offered", async () => {
    const runnable = testState.groups[0]!.candidates[0]!;
    const settingsOnly = {
      ...provider(),
      instanceId: ProviderInstanceId.make("claude-wsl"),
      driver: ProviderDriverKind.make("claudeAgent"),
      versionAdvisory: {
        ...provider().versionAdvisory!,
        updateCommand: null,
        canUpdate: false,
      },
    } as ProviderUpdateCandidate;
    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [runnable, settingsOnly],
      oneClickCandidates: [runnable],
      runnableCandidates: [runnable],
      providers: [runnable, settingsOnly],
    }));
    testState.updateProvider.mockRejectedValue(new Error("WebSocket closed"));

    renderRow().props.onUpdate();
    await flushPromises();
    expect(renderRow().props.status).toMatchObject({ kind: "failed", text: "WebSocket closed" });

    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [settingsOnly],
      oneClickCandidates: [],
      runnableCandidates: [],
      providers: [settingsOnly],
    }));

    expect(renderRow().props.status.kind).toBe("idle");
  });

  it("notifies the host when no row remains to render", () => {
    const onEmpty = vi.fn();
    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [],
      oneClickCandidates: [],
      runnableCandidates: [],
      providers: [],
    }));

    hooks.beginRender();
    const output = ProviderUpdateEnvironmentRows({ onEmpty });

    expect(output).toBeNull();
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it.each(["connecting", "disconnected", "error"] as const)(
    "keeps an empty interacted host open while an environment is %s",
    async (connectionState) => {
      const onEmpty = vi.fn();
      testState.updateProvider.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));
      renderRow().props.onUpdate();
      await flushPromises();
      testState.isAnySettling = connectionState === "connecting";
      testState.groups = testState.groups.map((group) => ({
        ...group,
        connectionState,
        isSettling: connectionState === "connecting",
        candidates: [],
        oneClickCandidates: [],
        runnableCandidates: [],
        providers: [],
      }));

      hooks.beginRender();
      const output = ProviderUpdateEnvironmentRows({ onEmpty });

      expect(output).toBeNull();
      expect(onEmpty).not.toHaveBeenCalled();
    },
  );

  it("ignores an unattempted disconnected candidate when closing an empty host", async () => {
    const onEmpty = vi.fn();
    const attemptedGroup = testState.groups[0]!;
    const unattemptedCandidate = {
      ...provider(),
      instanceId: ProviderInstanceId.make("codex-other-wsl"),
    } as ProviderUpdateCandidate;
    testState.groups = [
      attemptedGroup,
      {
        ...attemptedGroup,
        environmentId: "env-unrelated" as EnvironmentId,
        label: "Other WSL",
        candidates: [unattemptedCandidate],
        oneClickCandidates: [unattemptedCandidate],
        runnableCandidates: [unattemptedCandidate],
        providers: [unattemptedCandidate],
      },
    ];
    testState.updateProvider.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));

    renderRow().props.onUpdate();
    await flushPromises();

    testState.groups = testState.groups.map((group) => ({
      ...group,
      connectionState: group.environmentId === environmentId ? "ready" : "disconnected",
      candidates: [],
      oneClickCandidates: [],
      runnableCandidates: [],
      providers: group.environmentId === environmentId ? [provider("succeeded")] : [],
    }));

    hooks.beginRender();
    const output = ProviderUpdateEnvironmentRows({ onEmpty });

    expect(output).toBeNull();
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it("clears a lost-response error once a ready snapshot confirms the target is current", async () => {
    const onEmpty = vi.fn();
    testState.updateProvider.mockRejectedValue(new Error("WebSocket closed"));

    renderRow().props.onUpdate();
    await flushPromises();
    expect(renderRow().props.status.kind).toBe("failed");

    testState.groups = testState.groups.map((group) => ({
      ...group,
      candidates: [],
      oneClickCandidates: [],
      runnableCandidates: [],
      providers: [provider("succeeded")],
    }));
    hooks.beginRender();
    const output = ProviderUpdateEnvironmentRows({ onEmpty });

    expect(output).toBeNull();
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it("keeps a successor pending when an expired request resolves late, then shows its success", async () => {
    const firstRequest =
      deferred<ReturnType<typeof AsyncResult.success<{ providers: ServerProvider[] }>>>();
    const successorRequest =
      deferred<ReturnType<typeof AsyncResult.success<{ providers: ServerProvider[] }>>>();
    testState.updateProvider
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(successorRequest.promise);

    renderRow().props.onUpdate();
    expect(renderRow().props.status.kind).toBe("loading");

    await vi.advanceTimersByTimeAsync(pendingExpiryMs);
    expect(renderRow().props.status.kind).toBe("failed");

    renderRow().props.onUpdate();
    expect(testState.updateProvider).toHaveBeenCalledTimes(2);
    expect(renderRow().props.status.kind).toBe("loading");

    firstRequest.resolve(AsyncResult.success({ providers: [provider("succeeded")] }));
    await flushPromises();

    expect(renderRow().props.status.kind).toBe("loading");

    successorRequest.resolve(AsyncResult.success({ providers: [provider("succeeded")] }));
    await flushPromises();

    expect(renderRow().props.status.kind).toBe("success");
  });
});
