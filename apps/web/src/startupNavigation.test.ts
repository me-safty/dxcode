import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { NotificationNavigationTarget } from "./push/notificationNavigation";
import { shouldNavigateToStartupBootstrapThread } from "./startupNavigation";

const BOOTSTRAP_THREAD_ID = ThreadId.make("thread-startup");
const NOTIFICATION_THREAD_TARGET: NotificationNavigationTarget = {
  kind: "thread",
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("shouldNavigateToStartupBootstrapThread", () => {
  it("opens the bootstrap thread from the browser base route", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
        lastNotificationNavigationTarget: null,
        isStandalonePwa: false,
      }),
    ).toBe(true);
  });

  it("keeps standalone PWA launches on the base route", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
        lastNotificationNavigationTarget: null,
        isStandalonePwa: true,
      }),
    ).toBe(false);
  });

  it("does not override a notification navigation target", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
        lastNotificationNavigationTarget: NOTIFICATION_THREAD_TARGET,
        isStandalonePwa: false,
      }),
    ).toBe(false);
  });

  it("does not override an explicit route", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/env-1/thread-1",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
        lastNotificationNavigationTarget: null,
        isStandalonePwa: false,
      }),
    ).toBe(false);
  });

  it("does not repeat a handled bootstrap thread", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: BOOTSTRAP_THREAD_ID,
        lastNotificationNavigationTarget: null,
        isStandalonePwa: false,
      }),
    ).toBe(false);
  });
});
