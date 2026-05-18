import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { shouldNavigateToStartupBootstrapThread } from "./startupNavigation";

const BOOTSTRAP_THREAD_ID = ThreadId.make("thread-startup");

describe("shouldNavigateToStartupBootstrapThread", () => {
  it("opens the bootstrap thread from the browser base route", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
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
        isStandalonePwa: true,
      }),
    ).toBe(false);
  });

  it("does not override an explicit route", () => {
    expect(
      shouldNavigateToStartupBootstrapThread({
        pathname: "/env-1/thread-1",
        bootstrapThreadId: BOOTSTRAP_THREAD_ID,
        handledBootstrapThreadId: null,
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
        isStandalonePwa: false,
      }),
    ).toBe(false);
  });
});
