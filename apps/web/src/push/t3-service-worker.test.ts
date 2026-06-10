// @effect-diagnostics nodeBuiltinImport:off - Service worker tests execute browser worker assets in a Node VM.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://t3.example";
const TARGET_URL = `${ORIGIN}/env-1/thread-1`;
const HOME_URL = `${ORIGIN}/`;
const CROSS_ORIGIN_URL = "https://elsewhere.example/env-1/thread-1";
const DEFAULT_NOTIFICATION_TITLE = "Salchi";

interface MockClientState {
  readonly url: string;
  readonly focusCalls: number;
  readonly navigateCalls: string[];
  readonly postMessageCalls: Array<{
    readonly type: string;
    readonly url: string;
    readonly openedAt: number;
  }>;
}

interface ServiceWorkerTestHarness {
  readonly context: vm.Context;
  readonly openWindowCalls: string[];
  readonly operationLog: string[];
  readonly getClients: () => MockClientState[];
  readonly getPendingClickWrites: () => Array<{
    readonly cacheName: string;
    readonly requestUrl: string;
    readonly value: unknown;
  }>;
  readonly addClient: (options: {
    readonly url: string;
    readonly focusResult?: "self" | "throw";
    readonly focused?: boolean;
    readonly visibilityState?: "hidden" | "visible";
    readonly navigateResult?: "self" | "null" | "throw";
  }) => void;
  readonly setOpenWindowResult: (
    result: "undefined" | "client-at-url" | "client-at-home" | "throw",
  ) => void;
}

function createServiceWorkerTestHarness(): ServiceWorkerTestHarness {
  const openWindowCalls: string[] = [];
  const operationLog: string[] = [];
  const pendingClickWrites: Array<{
    cacheName: string;
    requestUrl: string;
    value: unknown;
  }> = [];
  let openWindowResult: "undefined" | "client-at-url" | "client-at-home" | "throw" = "undefined";
  const makeClient = (options: {
    readonly url: string;
    readonly focusResult?: "self" | "throw";
    readonly focused?: boolean;
    readonly visibilityState?: "hidden" | "visible";
    readonly navigateResult?: "self" | "null" | "throw";
  }) => {
    const client: Record<string, unknown> = {
      url: options.url,
      focused: options.focused === true,
      visibilityState: options.visibilityState ?? "visible",
      focusCalls: 0,
      navigateCalls: [],
      postMessageCalls: [],
    };
    client.focus = async () => {
      operationLog.push("focus");
      client.focusCalls = Number(client.focusCalls ?? 0) + 1;
      if (options.focusResult === "throw") {
        throw new Error("focus failed");
      }
      return client;
    };
    if (options.navigateResult !== undefined) {
      client.navigate = async (url: string) => {
        operationLog.push("navigate");
        (client.navigateCalls as string[]).push(url);
        if (options.navigateResult === "throw") {
          throw new Error("navigate failed");
        }
        if (options.navigateResult === "null") {
          return null;
        }
        client.url = url;
        return client;
      };
    }
    client.postMessage = (message: unknown) => {
      (client.postMessageCalls as unknown[]).push(message);
    };
    return client;
  };
  const context: Record<string, unknown> = {
    Request,
    Response,
    URL,
    console,
    __windowClients: [] as Array<Record<string, unknown>>,
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/` },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      skipWaiting: vi.fn(),
      clients: {
        matchAll: async () => context.__windowClients,
        openWindow: async (url: string) => {
          operationLog.push("openWindow");
          openWindowCalls.push(url);
          if (openWindowResult === "throw") {
            throw new Error("openWindow failed");
          }
          if (openWindowResult === "undefined") {
            return undefined;
          }
          const client = makeClient({
            url: openWindowResult === "client-at-home" ? HOME_URL : url,
          });
          (context.__windowClients as Array<Record<string, unknown>>).push(client);
          return client;
        },
      },
      caches: {
        open: async (cacheName: string) => ({
          put: async (request: Request, response: Response) => {
            operationLog.push("persist");
            pendingClickWrites.push({
              cacheName,
              requestUrl: request.url,
              value: await response.json(),
            });
          },
        }),
      },
    },
  };

  const serviceWorkerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../public/t3-push-service-worker.js",
  );
  const source = readFileSync(serviceWorkerPath, "utf8");

  vm.createContext(context);
  vm.runInContext(
    `${source}
this.__t3ServiceWorkerTestExports = {
  notificationTitle,
  openNotificationUrl,
};`,
    context,
  );

  return {
    context,
    openWindowCalls,
    operationLog,
    getClients: () =>
      (context.__windowClients as Array<Record<string, unknown>>).map((client) => ({
        url: String(client.url),
        focusCalls: Number(client.focusCalls ?? 0),
        navigateCalls: (client.navigateCalls as string[] | undefined) ?? [],
        postMessageCalls:
          (client.postMessageCalls as MockClientState["postMessageCalls"] | undefined) ?? [],
      })),
    getPendingClickWrites: () => pendingClickWrites,
    addClient: (options) => {
      (context.__windowClients as Array<Record<string, unknown>>).push(makeClient(options));
    },
    setOpenWindowResult: (result) => {
      openWindowResult = result;
    },
  };
}

async function openNotificationUrl(harness: ServiceWorkerTestHarness, url: string): Promise<void> {
  await vm.runInContext(
    `__t3ServiceWorkerTestExports.openNotificationUrl(${JSON.stringify(url)})`,
    harness.context,
  );
}

function notificationTitle(harness: ServiceWorkerTestHarness, rawTitle: unknown): string {
  return String(
    vm.runInContext(
      `__t3ServiceWorkerTestExports.notificationTitle(${JSON.stringify(rawTitle)})`,
      harness.context,
    ),
  );
}

describe("t3-service-worker notification click navigation", () => {
  let harness: ServiceWorkerTestHarness;

  beforeEach(() => {
    harness = createServiceWorkerTestHarness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips the app source suffix from notification titles", () => {
    expect(notificationTitle(harness, "Investigate deploy from Salchi")).toBe("Investigate deploy");
    expect(notificationTitle(harness, "Investigate deploy")).toBe("Investigate deploy");
    expect(notificationTitle(harness, "from Salchi")).toBe(DEFAULT_NOTIFICATION_TITLE);
  });

  it("opens a new window with the full URL when no same-origin client exists", async () => {
    await openNotificationUrl(harness, TARGET_URL);

    expect(harness.openWindowCalls).toEqual([TARGET_URL]);
  });

  it("posts the notification click to the client returned by openWindow", async () => {
    harness.setOpenWindowResult("client-at-home");

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(harness.openWindowCalls).toEqual([TARGET_URL]);
    expect(client?.url).toBe(HOME_URL);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
  });

  it("persists the notification click before window operations", async () => {
    harness.addClient({ url: TARGET_URL, focused: true, navigateResult: "self" });

    await openNotificationUrl(harness, TARGET_URL);

    const [write] = harness.getPendingClickWrites();
    expect(write).toMatchObject({
      cacheName: "t3-notification-click-v1",
      requestUrl: `${ORIGIN}/__t3-notification-click/pending`,
      value: {
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    });
    expect(harness.operationLog.indexOf("persist")).toBeLessThan(
      harness.operationLog.indexOf("focus"),
    );
  });

  it("ignores cross-origin clients when deciding whether the app is open", async () => {
    harness.addClient({ url: CROSS_ORIGIN_URL, focused: true });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.focusCalls).toBe(0);
    expect(client?.postMessageCalls).toEqual([]);
    expect(harness.openWindowCalls).toEqual([TARGET_URL]);
  });

  it("focuses an exact-url client without navigating", async () => {
    harness.addClient({ url: TARGET_URL, focused: true, navigateResult: "self" });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.focusCalls).toBe(1);
    expect(client?.navigateCalls).toEqual([]);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("treats trailing-slash variants as an exact-url match", async () => {
    harness.addClient({ url: `${TARGET_URL}/`, focused: true, navigateResult: "self" });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.focusCalls).toBe(1);
    expect(client?.navigateCalls).toEqual([]);
    expect(client?.postMessageCalls).toHaveLength(1);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("navigates a focused same-origin client before posting the click message", async () => {
    harness.addClient({
      url: HOME_URL,
      focused: true,
      navigateResult: "self",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.url).toBe(TARGET_URL);
    expect(client?.navigateCalls).toEqual([TARGET_URL]);
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("navigates a hidden same-origin client without opening a new window", async () => {
    harness.addClient({
      url: HOME_URL,
      visibilityState: "hidden",
      navigateResult: "self",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.url).toBe(TARGET_URL);
    expect(client?.navigateCalls).toEqual([TARGET_URL]);
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("focuses and posts without opening a new window when navigate is unavailable", async () => {
    harness.addClient({
      url: HOME_URL,
      focused: true,
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.url).toBe(HOME_URL);
    expect(client?.navigateCalls).toEqual([]);
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("focuses and posts without opening a new window when navigation returns null", async () => {
    harness.addClient({
      url: HOME_URL,
      focused: true,
      navigateResult: "null",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.url).toBe(HOME_URL);
    expect(client?.navigateCalls).toEqual([TARGET_URL]);
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("focuses and posts without opening a new window when navigation throws", async () => {
    harness.addClient({
      url: HOME_URL,
      focused: true,
      navigateResult: "throw",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.url).toBe(HOME_URL);
    expect(client?.navigateCalls).toEqual([TARGET_URL]);
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("posts the notification click when focus throws", async () => {
    harness.addClient({
      url: TARGET_URL,
      focused: true,
      focusResult: "throw",
      navigateResult: "self",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [client] = harness.getClients();
    expect(client?.focusCalls).toBe(1);
    expect(client?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });

  it("selects the exact target URL before a focused same-origin client", async () => {
    harness.addClient({
      url: HOME_URL,
      focused: true,
      navigateResult: "self",
    });
    harness.addClient({
      url: TARGET_URL,
      focused: false,
      navigateResult: "self",
    });

    await openNotificationUrl(harness, TARGET_URL);

    const [homeClient, targetClient] = harness.getClients();
    expect(homeClient?.focusCalls).toBe(0);
    expect(homeClient?.postMessageCalls).toEqual([]);
    expect(targetClient?.focusCalls).toBe(1);
    expect(targetClient?.navigateCalls).toEqual([]);
    expect(targetClient?.postMessageCalls).toEqual([
      {
        type: "t3.notification-click",
        url: TARGET_URL,
        openedAt: expect.any(Number),
      },
    ]);
    expect(harness.openWindowCalls).toEqual([]);
  });
});
