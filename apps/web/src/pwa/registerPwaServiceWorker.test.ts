import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerPwaServiceWorker } from "./registerPwaServiceWorker";
import { usePwaServiceWorkerUpdateStore } from "./serviceWorkerUpdateState";

type RegisterSWOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
};

type BrowserEnvironment = {
  dispatchVisibilityChange: () => void;
  intervalHandlers: Array<() => void>;
};

const registerSWMock = vi.hoisted(() => vi.fn());

vi.mock("virtual:pwa-register", () => ({
  registerSW: registerSWMock,
}));

function resetUpdateStore(): void {
  usePwaServiceWorkerUpdateStore.setState(usePwaServiceWorkerUpdateStore.getInitialState(), true);
}

function createDeferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function installBrowserEnvironment(options: { online?: boolean } = {}): BrowserEnvironment {
  const intervalHandlers: Array<() => void> = [];
  const visibilityChangeListeners: EventListener[] = [];

  vi.stubGlobal("window", {
    isSecureContext: true,
    setInterval: vi.fn((handler: TimerHandler) => {
      if (typeof handler === "function") {
        intervalHandlers.push(handler as () => void);
      }
      return intervalHandlers.length;
    }),
    setTimeout: ((handler: TimerHandler, timeout?: number) =>
      globalThis.setTimeout(handler, timeout) as unknown as number) as Window["setTimeout"],
  });
  vi.stubGlobal("navigator", {
    onLine: options.online ?? true,
    serviceWorker: {},
  });
  vi.stubGlobal("document", {
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type !== "visibilitychange") {
        return;
      }
      if (typeof listener === "function") {
        visibilityChangeListeners.push(listener);
      } else {
        visibilityChangeListeners.push((event) => listener.handleEvent(event));
      }
    }),
    visibilityState: "visible",
  });

  return {
    dispatchVisibilityChange: () => {
      for (const listener of visibilityChangeListeners) {
        listener({ type: "visibilitychange" } as Event);
      }
    },
    intervalHandlers,
  };
}

function createRegistration(
  update: () => Promise<void> = () => Promise.resolve(),
): ServiceWorkerRegistration {
  return { update: vi.fn(update) } as unknown as ServiceWorkerRegistration;
}

function readRegisterSWOptions(): RegisterSWOptions {
  const options = registerSWMock.mock.calls[0]?.[0] as RegisterSWOptions | undefined;
  if (!options) {
    throw new Error("registerSW was not called.");
  }
  return options;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("registerPwaServiceWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerSWMock.mockReset();
    registerSWMock.mockReturnValue(vi.fn(async () => {}));
    resetUpdateStore();
  });

  afterEach(() => {
    resetUpdateStore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks for updates immediately after production service worker registration", async () => {
    installBrowserEnvironment();
    const registration = createRegistration();

    registerPwaServiceWorker();
    const registerOptions = readRegisterSWOptions();
    expect(registerOptions.immediate).toBe(true);

    registerOptions.onRegisteredSW?.("/t3-service-worker.js", registration);

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(true);

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(800);

    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(false);
  });

  it("keeps a fast startup check visible for the startup minimum duration", async () => {
    installBrowserEnvironment();
    const registration = createRegistration();

    registerPwaServiceWorker();
    readRegisterSWOptions().onRegisteredSW?.("/t3-service-worker.js", registration);

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(799);

    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(false);
  });

  it("skips the startup update check while offline", () => {
    installBrowserEnvironment({ online: false });
    const registration = createRegistration();

    registerPwaServiceWorker();
    readRegisterSWOptions().onRegisteredSW?.("/t3-service-worker.js", registration);

    expect(registration.update).not.toHaveBeenCalled();
    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(false);
  });

  it("keeps visibility-change checks wired and coalesces them while a check is in flight", async () => {
    const browserEnvironment = installBrowserEnvironment();
    const startupUpdate = createDeferred();
    const registration = createRegistration(
      vi.fn().mockReturnValueOnce(startupUpdate.promise).mockResolvedValue(undefined),
    );

    registerPwaServiceWorker();
    readRegisterSWOptions().onRegisteredSW?.("/t3-service-worker.js", registration);

    expect(browserEnvironment.intervalHandlers).toHaveLength(1);
    expect(registration.update).toHaveBeenCalledTimes(1);

    browserEnvironment.dispatchVisibilityChange();

    expect(registration.update).toHaveBeenCalledTimes(1);

    startupUpdate.resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(800);

    browserEnvironment.dispatchVisibilityChange();

    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("marks a waiting update as ready even when an update check is visible", () => {
    installBrowserEnvironment();
    const startupUpdate = createDeferred();
    const updateServiceWorker = vi.fn(async () => {});
    const registration = createRegistration(() => startupUpdate.promise);
    registerSWMock.mockReturnValue(updateServiceWorker);

    registerPwaServiceWorker();
    const registerOptions = readRegisterSWOptions();
    registerOptions.onRegisteredSW?.("/t3-service-worker.js", registration);

    expect(usePwaServiceWorkerUpdateStore.getState().isCheckingForUpdate).toBe(true);

    registerOptions.onNeedRefresh?.();

    expect(usePwaServiceWorkerUpdateStore.getState()).toMatchObject({
      isCheckingForUpdate: true,
      status: "ready",
      updateServiceWorker,
    });
  });
});
