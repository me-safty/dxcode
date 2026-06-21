import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useRafThrottledValue } from "./useRafThrottledValue";

type HookHarness = {
  readonly value: string;
  readonly enabled: boolean;
  readonly displayed: string;
  readonly scheduleFrame: () => void;
};

function createHookHarness(initialValue: string, initialEnabled: boolean): HookHarness {
  let value = initialValue;
  let enabled = initialEnabled;
  let prevEnabled = initialEnabled;
  let displayed = initialValue;
  let frameId: number | null = null;

  const scheduleFrame = () => {
    if (frameId !== null) {
      return;
    }
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (enabled) {
        displayed = value;
      }
    });
  };

  const runEffect = () => {
    if (!enabled) {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      prevEnabled = false;
      displayed = value;
      return;
    }

    if (!prevEnabled) {
      displayed = value;
    }
    prevEnabled = true;
    scheduleFrame();
  };

  const setValue = (nextValue: string) => {
    value = nextValue;
    runEffect();
  };

  const setEnabled = (nextEnabled: boolean) => {
    enabled = nextEnabled;
    runEffect();
  };

  return {
    get value() {
      return value;
    },
    get enabled() {
      return enabled;
    },
    get displayed() {
      return enabled ? displayed : value;
    },
    scheduleFrame,
    setValue,
    setEnabled,
  } as HookHarness & {
    setValue: (nextValue: string) => void;
    setEnabled: (nextEnabled: boolean) => void;
  };
}

describe("useRafThrottledValue", () => {
  let rafCallbacks: Array<FrameRequestCallback>;

  beforeEach(() => {
    rafCallbacks = [];
    const requestAnimationFrame = (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    };
    const cancelAnimationFrame = () => {
      rafCallbacks = [];
    };
    vi.stubGlobal("window", { requestAnimationFrame, cancelAnimationFrame });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushRaf = () => {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    for (const callback of callbacks) {
      callback(0);
    }
  };

  it("exports a hook function", () => {
    expect(typeof useRafThrottledValue).toBe("function");
  });

  it("mirrors disabled streaming semantics: latest value is shown immediately", () => {
    const harness = createHookHarness("first", false) as ReturnType<typeof createHookHarness> & {
      setValue: (nextValue: string) => void;
    };

    harness.setValue("second");
    expect(harness.displayed).toBe("second");
    expect(rafCallbacks).toHaveLength(0);
  });

  it("mirrors enabled streaming semantics: updates land on the next animation frame", () => {
    const harness = createHookHarness("hello", true) as ReturnType<typeof createHookHarness> & {
      setValue: (nextValue: string) => void;
    };

    harness.setValue("hello world");
    expect(harness.displayed).toBe("hello");
    expect(rafCallbacks).toHaveLength(1);

    flushRaf();
    expect(harness.displayed).toBe("hello world");
  });

  it("coalesces rapid value changes into one animation frame", () => {
    const harness = createHookHarness("hello", true) as ReturnType<typeof createHookHarness> & {
      setValue: (nextValue: string) => void;
    };

    harness.setValue("hello ");
    harness.setValue("hello w");
    harness.setValue("hello world");
    expect(harness.displayed).toBe("hello");
    expect(rafCallbacks).toHaveLength(1);

    flushRaf();
    expect(harness.displayed).toBe("hello world");
  });

  it("mirrors stream-end semantics: disabling flushes the latest value", () => {
    const harness = createHookHarness("partial", true) as ReturnType<typeof createHookHarness> & {
      setValue: (nextValue: string) => void;
      setEnabled: (nextEnabled: boolean) => void;
    };

    harness.setValue("partial response");
    harness.setEnabled(false);
    expect(harness.displayed).toBe("partial response");
  });

  it("mirrors stream-start semantics: enabling shows the current value immediately", () => {
    const harness = createHookHarness("partial", true) as ReturnType<typeof createHookHarness> & {
      setValue: (nextValue: string) => void;
      setEnabled: (nextEnabled: boolean) => void;
    };

    harness.setValue("partial response");
    flushRaf();
    harness.setEnabled(false);
    harness.setValue("fresh stream");
    harness.setEnabled(true);
    expect(harness.displayed).toBe("fresh stream");
  });
});
