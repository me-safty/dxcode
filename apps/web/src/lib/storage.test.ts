import { describe, expect, it } from "vite-plus/test";

import { createResilientStorage, type StateStorage } from "./storage";

describe("createResilientStorage", () => {
  it("keeps the latest value in memory when the primary storage exceeds quota", () => {
    const primary: StateStorage = {
      getItem: () => "stale",
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const storage = createResilientStorage(primary);

    expect(() => storage.setItem("queue", "latest")).not.toThrow();
    expect(storage.getItem("queue")).toBe("latest");
  });

  it("returns to primary persistence after a later write succeeds", () => {
    let shouldFail = true;
    let persisted: string | null = null;
    const primary: StateStorage = {
      getItem: () => persisted,
      setItem: (_name, value) => {
        if (shouldFail) throw new DOMException("quota", "QuotaExceededError");
        persisted = value;
      },
      removeItem: () => {
        persisted = null;
      },
    };
    const storage = createResilientStorage(primary);

    storage.setItem("queue", "fallback");
    shouldFail = false;
    storage.setItem("queue", "persisted");

    expect(storage.getItem("queue")).toBe("persisted");
  });
});
