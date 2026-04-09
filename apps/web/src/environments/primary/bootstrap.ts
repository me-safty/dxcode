import {
  attachEnvironmentDescriptor,
  createKnownEnvironment,
  type KnownEnvironment,
} from "@t3tools/client-runtime";
import type {
  DesktopEnvironmentBootstrap,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { create } from "zustand";

import { BootstrapHttpError, retryTransientBootstrap } from "../shared/bootstrapHttp";
import { createWebSocketBaseUrlFromHttpBaseUrl, resolveHttpUrlFromBase } from "../shared/url";

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

function getDesktopLocalEnvironmentBootstrap(): DesktopEnvironmentBootstrap | null {
  return window.desktopBridge?.getLocalEnvironmentBootstrap() ?? null;
}

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

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString();
}

function resolveConfiguredPrimaryTarget(): {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
} | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim();
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim();

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null;
  }

  if (!configuredHttpBaseUrl || !configuredWsBaseUrl) {
    throw new Error("Configured primary environments require both VITE_HTTP_URL and VITE_WS_URL.");
  }

  return {
    source: "configured",
    target: {
      httpBaseUrl: normalizeBaseUrl(configuredHttpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(configuredWsBaseUrl),
    },
  };
}

function resolveWindowOriginPrimaryTarget(): {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
} {
  const httpBaseUrl = normalizeBaseUrl(window.location.origin);
  return {
    source: "window-origin",
    target: {
      httpBaseUrl,
      wsBaseUrl: createWebSocketBaseUrlFromHttpBaseUrl(httpBaseUrl),
    },
  };
}

function resolveDesktopPrimaryTarget(): {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
} | null {
  const desktopBootstrap = getDesktopLocalEnvironmentBootstrap();
  if (!desktopBootstrap) {
    return null;
  }
  if (!desktopBootstrap.httpBaseUrl && !desktopBootstrap.wsBaseUrl) {
    return null;
  }
  if (!desktopBootstrap.httpBaseUrl || !desktopBootstrap.wsBaseUrl) {
    throw new Error(
      "Desktop bootstrap must provide both httpBaseUrl and wsBaseUrl for the local environment.",
    );
  }

  return {
    source: "desktop-managed",
    target: {
      httpBaseUrl: normalizeBaseUrl(desktopBootstrap.httpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(desktopBootstrap.wsBaseUrl),
    },
  };
}

function readPrimaryEnvironmentTarget(): {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
} | null {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  );
}

async function fetchPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl(SERVER_ENVIRONMENT_DESCRIPTOR_PATH),
    );
    if (!response.ok) {
      throw new BootstrapHttpError(
        `Failed to load server environment descriptor (${response.status}).`,
        response.status,
      );
    }

    const descriptor = (await response.json()) as ExecutionEnvironmentDescriptor;
    writePrimaryEnvironmentDescriptor(descriptor);
    return descriptor;
  });
}

export function readPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptor | null {
  return usePrimaryEnvironmentBootstrapStore.getState().descriptor;
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

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    throw new Error("Unable to resolve the primary environment HTTP base URL.");
  }

  return resolveHttpUrlFromBase({
    httpBaseUrl: primaryTarget.target.httpBaseUrl,
    pathname,
    ...(searchParams ? { searchParams } : {}),
  });
}

export function resolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (descriptor) {
    return Promise.resolve(descriptor);
  }

  if (primaryEnvironmentDescriptorPromise) {
    return primaryEnvironmentDescriptorPromise;
  }

  const nextPromise = fetchPrimaryEnvironmentDescriptor();
  primaryEnvironmentDescriptorPromise = nextPromise;
  return nextPromise.finally(() => {
    if (primaryEnvironmentDescriptorPromise === nextPromise) {
      primaryEnvironmentDescriptorPromise = null;
    }
  });
}

export function __resetPrimaryEnvironmentBootstrapForTests(): void {
  primaryEnvironmentDescriptorPromise = null;
  usePrimaryEnvironmentBootstrapStore.getState().reset();
}

export const resetPrimaryEnvironmentDescriptorForTests = __resetPrimaryEnvironmentBootstrapForTests;

export const __resetPrimaryEnvironmentDescriptorBootstrapForTests =
  __resetPrimaryEnvironmentBootstrapForTests;
