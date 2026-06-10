import { describe, expect, it, vi, afterEach } from "vitest";

import type { AppRouter } from "../router";
import {
  readPendingNotificationClick,
  writePendingNotificationClick,
} from "./pendingNotificationClick";
import {
  consumePendingNotificationClick,
  getLastNotificationNavigationTarget,
  installServiceWorkerNotificationNavigation,
  isNotificationClickClientMessage,
  parseNotificationNavigationTarget,
  resetNotificationNavigationStateForTests,
  resolveNotificationUrl,
} from "./notificationNavigation";

const ORIGIN = "https://example.test";

function createCacheStorageMock() {
  const entries = new Map<string, Response>();
  const cache = {
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
  };
  const cacheStorage = {
    open: vi.fn(async () => cache),
  };
  return {
    cache,
    cacheStorage,
  };
}

function stubServiceWorker(options: { readonly cacheStorage?: CacheStorage } = {}) {
  const serviceWorkerTarget = new EventTarget();
  const windowTarget = new EventTarget();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      addEventListener: serviceWorkerTarget.addEventListener.bind(serviceWorkerTarget),
      removeEventListener: serviceWorkerTarget.removeEventListener.bind(serviceWorkerTarget),
    },
  });
  vi.stubGlobal("window", {
    ...(options.cacheStorage ? { caches: options.cacheStorage } : {}),
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    location: { origin: ORIGIN },
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  });

  return {
    dispatch(data: unknown) {
      const event = new Event("message") as MessageEvent;
      Object.defineProperty(event, "data", { value: data });
      serviceWorkerTarget.dispatchEvent(event);
    },
    dispatchWindowEvent(type: string) {
      windowTarget.dispatchEvent(new Event(type));
    },
  };
}

function makeRouter() {
  return {
    navigate: vi.fn(() => Promise.resolve()),
  } as unknown as AppRouter & {
    readonly navigate: ReturnType<typeof vi.fn>;
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("notificationNavigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetNotificationNavigationStateForTests();
    vi.restoreAllMocks();
  });

  it("recognizes notification click service worker messages", () => {
    expect(
      isNotificationClickClientMessage({
        type: "t3.notification-click",
        url: "/env-1/thread-1",
      }),
    ).toBe(true);
    expect(isNotificationClickClientMessage({ type: "other", url: "/env-1/thread-1" })).toBe(false);
    expect(isNotificationClickClientMessage({ type: "t3.notification-click" })).toBe(false);
  });

  it("resolves same-origin URLs and rejects cross-origin URLs", () => {
    expect(resolveNotificationUrl("/env-1/thread-1", ORIGIN)?.href).toBe(
      "https://example.test/env-1/thread-1",
    );
    expect(resolveNotificationUrl("https://elsewhere.test/env-1/thread-1", ORIGIN)).toBeNull();
    expect(resolveNotificationUrl("http://[::1", ORIGIN)).toBeNull();
  });

  it("parses thread notification URLs", () => {
    expect(parseNotificationNavigationTarget("/env-1/thread-1", ORIGIN)).toEqual({
      kind: "thread",
      environmentId: "env-1",
      threadId: "thread-1",
    });
    expect(
      parseNotificationNavigationTarget(
        "https://example.test/env%20one/thread%2Done?diff=1",
        ORIGIN,
      ),
    ).toEqual({
      kind: "thread",
      environmentId: "env one",
      threadId: "thread-one",
    });
  });

  it("parses home, draft, settings, and pair targets", () => {
    expect(parseNotificationNavigationTarget("/", ORIGIN)).toEqual({ kind: "home" });
    expect(parseNotificationNavigationTarget("/draft/draft-1", ORIGIN)).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
    expect(parseNotificationNavigationTarget("/settings/providers", ORIGIN)).toEqual({
      kind: "settings",
      to: "/settings/providers",
    });
    expect(parseNotificationNavigationTarget("/pair", ORIGIN)).toEqual({ kind: "pair" });
  });

  it("ignores malformed or unsupported targets", () => {
    expect(
      parseNotificationNavigationTarget("https://elsewhere.test/env/thread", ORIGIN),
    ).toBeNull();
    expect(parseNotificationNavigationTarget("/settings/unknown", ORIGIN)).toBeNull();
    expect(parseNotificationNavigationTarget("/one/two/three", ORIGIN)).toBeNull();
    expect(parseNotificationNavigationTarget("/env/%E0%A4%A", ORIGIN)).toBeNull();
  });

  it("navigates service worker click messages through the app router", async () => {
    const service = await import("../environments/runtime/service");
    const reconcileSpy = vi
      .spyOn(service, "reconcileAfterNotificationClick")
      .mockImplementation(() => undefined);

    const serviceWorker = stubServiceWorker();
    const router = makeRouter();

    const cleanup = installServiceWorkerNotificationNavigation(router);
    const openedAt = Date.now();
    serviceWorker.dispatch({
      type: "t3.notification-click",
      url: "/env-1/thread-1",
      openedAt,
    });

    expect(router.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
      search: {},
    });
    expect(getLastNotificationNavigationTarget()).toEqual({
      kind: "thread",
      environmentId: "env-1",
      threadId: "thread-1",
    });
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledWith(
      {
        kind: "thread",
        environmentId: "env-1",
        threadId: "thread-1",
      },
      {
        openedAt,
      },
    );

    cleanup();
    serviceWorker.dispatch({
      type: "t3.notification-click",
      url: "/env-2/thread-2",
    });
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it("replays a persisted notification target on startup", async () => {
    const service = await import("../environments/runtime/service");
    const reconcileSpy = vi
      .spyOn(service, "reconcileAfterNotificationClick")
      .mockImplementation(() => undefined);
    const { cacheStorage } = createCacheStorageMock();
    stubServiceWorker({ cacheStorage: cacheStorage as unknown as CacheStorage });
    const router = makeRouter();
    const openedAt = Date.now();

    await writePendingNotificationClick({
      url: "/env-1/thread-1",
      openedAt,
    });

    const cleanup = installServiceWorkerNotificationNavigation(router);
    await flushAsync();

    expect(router.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
      search: {},
    });
    expect(getLastNotificationNavigationTarget()).toEqual({
      kind: "thread",
      environmentId: "env-1",
      threadId: "thread-1",
    });
    expect(reconcileSpy).toHaveBeenCalledWith(
      {
        kind: "thread",
        environmentId: "env-1",
        threadId: "thread-1",
      },
      {
        openedAt,
      },
    );
    await expect(readPendingNotificationClick()).resolves.toBeNull();

    cleanup();
  });

  it("replays a persisted notification target on focus", async () => {
    const service = await import("../environments/runtime/service");
    vi.spyOn(service, "reconcileAfterNotificationClick").mockImplementation(() => undefined);
    const { cacheStorage } = createCacheStorageMock();
    const serviceWorker = stubServiceWorker({
      cacheStorage: cacheStorage as unknown as CacheStorage,
    });
    const router = makeRouter();

    const cleanup = installServiceWorkerNotificationNavigation(router);
    await flushAsync();
    expect(router.navigate).not.toHaveBeenCalled();

    await writePendingNotificationClick({
      url: "/env-2/thread-2",
      openedAt: Date.now(),
    });
    serviceWorker.dispatchWindowEvent("focus");
    await flushAsync();

    expect(router.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: "env-2",
        threadId: "thread-2",
      },
      search: {},
    });

    cleanup();
  });

  it("clears malformed or cross-origin persisted notification targets", async () => {
    const service = await import("../environments/runtime/service");
    const reconcileSpy = vi
      .spyOn(service, "reconcileAfterNotificationClick")
      .mockImplementation(() => undefined);
    const { cacheStorage } = createCacheStorageMock();
    stubServiceWorker({ cacheStorage: cacheStorage as unknown as CacheStorage });
    const router = makeRouter();

    await writePendingNotificationClick({
      url: "https://elsewhere.test/env-1/thread-1",
      openedAt: Date.now(),
    });
    await consumePendingNotificationClick(router, "test");

    expect(router.navigate).not.toHaveBeenCalled();
    expect(reconcileSpy).not.toHaveBeenCalled();
    await expect(readPendingNotificationClick()).resolves.toBeNull();
  });

  it("does nothing when service workers are unavailable", () => {
    vi.stubGlobal("navigator", {});
    const router = makeRouter();

    const cleanup = installServiceWorkerNotificationNavigation(router);

    cleanup();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
