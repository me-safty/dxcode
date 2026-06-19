import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { DRIVER_OPTION_BY_VALUE } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  parseProviderConfigStringArrayDraft,
  readProviderConfigBoolean,
  readProviderConfigString,
  readProviderConfigStringArray,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("derives visible provider config fields from the client definition schema", () => {
    const codex = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("codex")];

    expect(codex).toBeDefined();
    expect(deriveProviderSettingsFields(codex!).map((field) => field.key)).toEqual([
      "binaryPath",
      "homePath",
      "shadowHomePath",
    ]);
  });

  it("sources labels and descriptions from schema annotations", () => {
    const opencode = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("opencode")];
    expect(opencode).toBeDefined();

    const serverPassword = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverPassword",
    );

    expect(serverPassword).toMatchObject({
      label: "Server password",
      description: "Stored in plain text on disk.",
      control: "password",
    });
  });

  it("derives Grok arguments as a string-array control", () => {
    const grokBuild = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("grok-build")];
    expect(grokBuild).toBeDefined();

    const args = deriveProviderSettingsFields(grokBuild!).find((field) => field.key === "args");

    expect(args).toMatchObject({
      label: "Arguments",
      description: "Arguments to pass to the Grok Build CLI, one per line.",
      control: "string-array",
      placeholder: "agent\nstdio",
      clearWhenEmpty: "omit",
    });
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const opencode = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("opencode")];
    expect(opencode).toBeDefined();

    const serverUrl = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverUrl",
    );
    expect(serverUrl).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, serverUrl: "http://127.0.0.1:4096" },
      serverUrl!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("reads non-string config values as blank strings", () => {
    expect(readProviderConfigString({ binaryPath: 123 }, "binaryPath")).toBe("");
  });

  it("reads string-array config values and tolerates legacy newline strings", () => {
    expect(readProviderConfigStringArray({ args: ["agent", "stdio", 42] }, "args")).toEqual([
      "agent",
      "stdio",
    ]);
    expect(readProviderConfigStringArray({ args: "agent\nstdio" }, "args")).toEqual([
      "agent",
      "stdio",
    ]);
  });

  it("parses string-array drafts one item per non-empty line", () => {
    expect(parseProviderConfigStringArrayDraft(" agent \n\nstdio\n  --flag  ")).toEqual([
      "agent",
      "stdio",
      "--flag",
    ]);
  });

  it("stores and clears string-array fields without changing unknown config keys", () => {
    const field = {
      key: "args",
      control: "string-array" as const,
      label: "Arguments",
      clearWhenEmpty: "omit" as const,
    };

    expect(
      nextProviderConfigWithFieldValue({ forkOwned: 1 }, field, [" agent ", "", "stdio"]),
    ).toEqual({
      forkOwned: 1,
      args: ["agent", "stdio"],
    });
    expect(
      nextProviderConfigWithFieldValue({ forkOwned: 1, args: ["agent", "stdio"] }, field, []),
    ).toEqual({
      forkOwned: 1,
    });
  });

  it("omits false boolean fields when clearWhenEmpty is omit", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: true },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: false,
      },
      false,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits true boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: false },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      true,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("preserves false boolean fields when clearWhenEmpty is persist", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "persist",
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("reads non-boolean config values as false booleans", () => {
    expect(readProviderConfigBoolean({ experimental: "true" }, "experimental")).toBe(false);
  });

  it("reads missing boolean config values from the supplied default", () => {
    expect(readProviderConfigBoolean({}, "experimental", true)).toBe(true);
  });
});
