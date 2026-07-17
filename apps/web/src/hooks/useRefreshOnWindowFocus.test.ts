import { describe, expect, it, vi } from "vite-plus/test";

import { subscribeWindowFocusRefresh } from "./useRefreshOnWindowFocus";

class FakeWindow extends EventTarget {
  readonly timeouts = new Map<number, () => void>();
  #nextTimeoutId = 0;

  setTimeout(callback: () => void): number {
    const timeoutId = ++this.#nextTimeoutId;
    this.timeouts.set(timeoutId, callback);
    return timeoutId;
  }

  clearTimeout(timeoutId: number): void {
    this.timeouts.delete(timeoutId);
  }

  flushTimeouts(): void {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    for (const callback of callbacks) callback();
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "hidden";
}

describe("subscribeWindowFocusRefresh", () => {
  it("debounces focus and visible events into one refresh", () => {
    const windowTarget = new FakeWindow();
    const documentTarget = new FakeDocument();
    const refresh = vi.fn();
    subscribeWindowFocusRefresh(refresh, { windowTarget, documentTarget });

    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).not.toHaveBeenCalled();

    windowTarget.flushTimeouts();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("ignores hidden visibility and cleans up pending refreshes", () => {
    const windowTarget = new FakeWindow();
    const documentTarget = new FakeDocument();
    const refresh = vi.fn();
    const unsubscribe = subscribeWindowFocusRefresh(refresh, { windowTarget, documentTarget });

    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("focus"));
    unsubscribe();
    windowTarget.flushTimeouts();
    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.flushTimeouts();

    expect(refresh).not.toHaveBeenCalled();
  });
});
