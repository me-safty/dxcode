import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeThreadNotifications } from "./notifications";

interface FakeNotification {
  readonly tag: string;
  closed: boolean;
  readonly close: () => void;
}

function makeNotification(tag: string): FakeNotification {
  const notification: FakeNotification = {
    tag,
    closed: false,
    close: () => {
      notification.closed = true;
    },
  };
  return notification;
}

function installPushSupport(getRegistration: () => Promise<unknown>): void {
  vi.stubGlobal("window", {
    isSecureContext: true,
    PushManager: function PushManager() {},
    Notification: function Notification() {},
  });
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration },
  });
}

describe("closeThreadNotifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes only notifications whose tag matches the thread prefix", async () => {
    const notifications = [
      makeNotification("thread:thread-1:turn:turn-1"),
      makeNotification("thread:thread-1:approval:activity-1"),
      makeNotification("thread:thread-2:turn:turn-1"),
      makeNotification("t3code"),
    ];
    installPushSupport(async () => ({
      getNotifications: async () => notifications,
    }));

    await closeThreadNotifications("thread-1");

    expect(notifications.map((notification) => notification.closed)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("is a no-op when there is no service worker registration", async () => {
    const getRegistration = vi.fn(async () => null);
    installPushSupport(getRegistration);

    await expect(closeThreadNotifications("thread-1")).resolves.toBeUndefined();
    expect(getRegistration).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when push is unsupported", async () => {
    const getRegistration = vi.fn(async () => null);
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    await expect(closeThreadNotifications("thread-1")).resolves.toBeUndefined();
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("swallows errors from the service worker registration lookup", async () => {
    installPushSupport(async () => {
      throw new Error("registration lookup failed");
    });

    await expect(closeThreadNotifications("thread-1")).resolves.toBeUndefined();
  });
});

describe("closeThreadNotifications input guards", () => {
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    }
  });

  it("does nothing for an empty thread id", async () => {
    const getRegistration = vi.fn(async () => null);
    installPushSupport(getRegistration);

    await closeThreadNotifications("");

    expect(getRegistration).not.toHaveBeenCalled();
  });
});
