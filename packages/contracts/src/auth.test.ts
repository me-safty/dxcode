import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationReadScope,
  AuthPluginsManageScope,
  AuthStandardClientScopes,
  PluginScope,
  pluginOperateScope,
  pluginReadScope,
  satisfiesScope,
} from "./auth.ts";

const decodePluginScope = Schema.decodeUnknownSync(PluginScope);

describe("PluginScope", () => {
  it.each(["plugin:test-plugin:read", "plugin:test-plugin:operate"])(
    "accepts valid plugin scope %s",
    (scope) => {
      expect(decodePluginScope(scope)).toBe(scope);
    },
  );

  it.each([
    "plugin:x:read",
    "plugin:1test-plugin:read",
    "plugin:test_plugin:read",
    "plugin:Test-Plugin:read",
    "plugin:test-plugin:write",
    "plugin:test-plugin",
    "test-plugin:read",
    `plugin:${"a".repeat(42)}:read`,
  ])("rejects invalid plugin scope %s", (scope) => {
    expect(() => decodePluginScope(scope)).toThrow();
  });

  it("builds validated read and operate scope strings", () => {
    expect(pluginReadScope("test-plugin")).toBe("plugin:test-plugin:read");
    expect(pluginOperateScope("test-plugin")).toBe("plugin:test-plugin:operate");
  });
});

describe("satisfiesScope", () => {
  it("requires exact membership for core scopes", () => {
    expect(satisfiesScope(AuthOrchestrationReadScope, [AuthOrchestrationReadScope])).toBe(true);
    expect(satisfiesScope(AuthPluginsManageScope, [AuthPluginsManageScope])).toBe(true);
    expect(satisfiesScope(AuthPluginsManageScope, [AuthOrchestrationReadScope])).toBe(false);
  });

  it("accepts exact plugin-scope membership", () => {
    const required = pluginReadScope("test-plugin");

    expect(satisfiesScope(required, [required])).toBe(true);
    expect(satisfiesScope(required, [pluginOperateScope("test-plugin")])).toBe(false);
  });

  it("allows a full standard client scope bundle to satisfy plugin scopes", () => {
    expect(satisfiesScope(pluginReadScope("test-plugin"), AuthStandardClientScopes)).toBe(true);
    expect(satisfiesScope(pluginOperateScope("test-plugin"), AuthStandardClientScopes)).toBe(true);
  });

  it("does not treat a partial standard client scope set as implicit plugin access", () => {
    const partialStandard = AuthStandardClientScopes.filter(
      (scope) => scope !== AuthPluginsManageScope,
    );

    expect(satisfiesScope(pluginReadScope("test-plugin"), partialStandard)).toBe(false);
  });
});
