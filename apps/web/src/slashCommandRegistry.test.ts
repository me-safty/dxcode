import { describe, expect, it } from "vitest";
import { slashCommandRegistry } from "./slashCommandRegistry";

describe("slashCommandRegistry", () => {
  describe("built-in commands", () => {
    it("registers /model, /plan, and /default on import", () => {
      expect(slashCommandRegistry.has("model")).toBe(true);
      expect(slashCommandRegistry.has("plan")).toBe(true);
      expect(slashCommandRegistry.has("default")).toBe(true);
    });

    it("marks /plan and /default as standalone", () => {
      expect(slashCommandRegistry.getStandaloneNames()).toContain("plan");
      expect(slashCommandRegistry.getStandaloneNames()).toContain("default");
      expect(slashCommandRegistry.getStandaloneNames()).not.toContain("model");
    });

    it("exposes all registered command names", () => {
      const names = slashCommandRegistry.getNames();
      expect(names).toContain("model");
      expect(names).toContain("plan");
      expect(names).toContain("default");
    });

    it("/model uses trigger-transition action", () => {
      const def = slashCommandRegistry.get("model");
      expect(def?.action.type).toBe("trigger-transition");
    });

    it("/plan uses set-interaction-mode action with mode plan", () => {
      const def = slashCommandRegistry.get("plan");
      expect(def?.action).toEqual({ type: "set-interaction-mode", mode: "plan" });
    });

    it("/default uses set-interaction-mode action with mode default", () => {
      const def = slashCommandRegistry.get("default");
      expect(def?.action).toEqual({ type: "set-interaction-mode", mode: "default" });
    });
  });

  describe("register/unregister", () => {
    it("registers a custom command and returns an unregister function", () => {
      const unregister = slashCommandRegistry.register({
        name: "test-cmd",
        description: "A test command",
        action: { type: "callback", execute: () => {} },
      });
      expect(slashCommandRegistry.has("test-cmd")).toBe(true);
      unregister();
      expect(slashCommandRegistry.has("test-cmd")).toBe(false);
    });

    it("overwrites a command with the same name", () => {
      const unregister1 = slashCommandRegistry.register({
        name: "overwrite-test",
        description: "First",
        action: { type: "callback", execute: () => {} },
      });
      const unregister2 = slashCommandRegistry.register({
        name: "overwrite-test",
        description: "Second",
        action: { type: "callback", execute: () => {} },
      });
      expect(slashCommandRegistry.get("overwrite-test")?.description).toBe("Second");
      unregister1();
      expect(slashCommandRegistry.has("overwrite-test")).toBe(true);
      unregister2();
      expect(slashCommandRegistry.has("overwrite-test")).toBe(false);
    });
  });

  describe("match", () => {
    it("returns all commands for empty query", () => {
      expect(slashCommandRegistry.match("")).toEqual(slashCommandRegistry.getAll());
    });

    it("filters commands by partial name match", () => {
      const results = slashCommandRegistry.match("pl");
      expect(results.some((c) => c.name === "plan")).toBe(true);
    });
  });

  describe("subscribe", () => {
    it("notifies listeners on register", () => {
      let called = 0;
      const unsub = slashCommandRegistry.subscribe(() => {
        called++;
      });
      const unreg = slashCommandRegistry.register({
        name: "sub-test",
        description: "sub",
        action: { type: "callback", execute: () => {} },
      });
      expect(called).toBe(1);
      unreg();
      unsub();
    });
  });
});
