import { describe, expect, it } from "vitest";

import { waitForAbortSignal } from "./ClaudeProvider.ts";

describe("waitForAbortSignal", () => {
  it("stays pending until the signal aborts", async () => {
    const abort = new AbortController();
    let settled = false;
    const waitPromise = waitForAbortSignal(abort.signal).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    abort.abort();
    await waitPromise;
    expect(settled).toBe(true);
  });

  it("resolves immediately for an already-aborted signal", async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(waitForAbortSignal(abort.signal)).resolves.toBeUndefined();
  });
});
