import {
  attachEnvironmentDescriptor,
  createKnownEnvironment,
  type KnownEnvironment,
} from "@t3tools/client-runtime";
import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { create } from "zustand";

import { BootstrapHttpError, retryTransientBootstrap } from "./auth";

import { readPrimaryEnvironmentTarget, resolvePrimaryEnvironmentHttpUrl } from "./target";

const SERVER_ENVIRONMENT_DESCRIPTOR_PATH = "/.well-known/t3/environment";

interface PrimaryEnvironmentBootstrapState {
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
  readonly setDescriptor: (descriptor: ExecutionEnvironmentDescriptor | null) => void;
  readonly reset: () => void;
}

const usePrimaryEnvironmentBootstrapStore = create<PrimaryEnvironmentBootstrapState>()((set) => ({
  descriptor: null,
  setDescriptor: (descriptor) => set({ descriptor }),
  reset: () => set({ descriptor: null }),
}));

let primaryEnvironmentDescriptorPromise: Promise<ExecutionEnvironmentDescriptor> | null = null;
let primaryEnvironmentDescriptorRequestId = 0;
let subscribedBackendConnectionBridge: typeof window.t3HostBridge | null = null;
let unsubscribeBackendConnectionBridge: (() => void) | null = null;

function createPrimaryKnownEnvironment(input: {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}): KnownEnvironment | null {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (!descriptor) {
    return null;
  }

  return attachEnvironmentDescriptor(
    createKnownEnvironment({
      id: descriptor.environmentId,
      label: descriptor.label,
      source: input.source,
      target: input.target,
    }),
    descriptor,
  );
}

async function fetchPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl(SERVER_ENVIRONMENT_DESCRIPTOR_PATH),
    );
    if (!response.ok) {
      throw new BootstrapHttpError({
        message: `Failed to load server environment descriptor (${response.status}).`,
        status: response.status,
      });
    }

    const descriptor = (await response.json()) as ExecutionEnvironmentDescriptor;
    return descriptor;
  });
}

function requestPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const requestId = (primaryEnvironmentDescriptorRequestId += 1);
  const nextPromise = fetchPrimaryEnvironmentDescriptor().then((descriptor) => {
    if (requestId === primaryEnvironmentDescriptorRequestId) {
      writePrimaryEnvironmentDescriptor(descriptor);
    }
    return descriptor;
  });
  primaryEnvironmentDescriptorPromise = nextPromise;
  return nextPromise.finally(() => {
    if (primaryEnvironmentDescriptorPromise === nextPromise) {
      primaryEnvironmentDescriptorPromise = null;
    }
  });
}

function ensureBackendConnectionBridgeSubscription(): void {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.t3HostBridge ?? null;
  if (bridge === subscribedBackendConnectionBridge) {
    return;
  }

  unsubscribeBackendConnectionBridge?.();
  unsubscribeBackendConnectionBridge = null;
  subscribedBackendConnectionBridge = bridge;

  if (!bridge?.onBackendConnectionChanged) {
    return;
  }

  unsubscribeBackendConnectionBridge = bridge.onBackendConnectionChanged(() => {
    void refreshPrimaryEnvironmentDescriptor().catch((error: unknown) => {
      console.warn("Failed to refresh T3 environment descriptor after backend restart.", error);
    });
  });
}

export function readPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptor | null {
  return usePrimaryEnvironmentBootstrapStore.getState().descriptor;
}

export function usePrimaryEnvironmentId(): EnvironmentId | null {
  return usePrimaryEnvironmentBootstrapStore((state) => state.descriptor?.environmentId ?? null);
}

export function writePrimaryEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor | null,
): void {
  usePrimaryEnvironmentBootstrapStore.getState().setDescriptor(descriptor);
}

export function getPrimaryKnownEnvironment(): KnownEnvironment | null {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    return null;
  }

  return createPrimaryKnownEnvironment({
    source: primaryTarget.source,
    target: primaryTarget.target,
  });
}

export function resolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  ensureBackendConnectionBridgeSubscription();
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (descriptor) {
    return Promise.resolve(descriptor);
  }

  if (primaryEnvironmentDescriptorPromise) {
    return primaryEnvironmentDescriptorPromise;
  }

  return requestPrimaryEnvironmentDescriptor();
}

export function refreshPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  ensureBackendConnectionBridgeSubscription();
  return requestPrimaryEnvironmentDescriptor();
}

export function __resetPrimaryEnvironmentBootstrapForTests(): void {
  primaryEnvironmentDescriptorPromise = null;
  primaryEnvironmentDescriptorRequestId = 0;
  unsubscribeBackendConnectionBridge?.();
  unsubscribeBackendConnectionBridge = null;
  subscribedBackendConnectionBridge = null;
  usePrimaryEnvironmentBootstrapStore.getState().reset();
}

export const resetPrimaryEnvironmentDescriptorForTests = __resetPrimaryEnvironmentBootstrapForTests;

export const __resetPrimaryEnvironmentDescriptorBootstrapForTests =
  __resetPrimaryEnvironmentBootstrapForTests;
