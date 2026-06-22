import { describe, expect, it } from "vite-plus/test";

import { playNotificationTone } from "./notificationSound.ts";

describe("playNotificationTone", () => {
  it("does not throw when AudioContext is unavailable (jsdom)", () => {
    expect(() => playNotificationTone()).not.toThrow();
  });
});
