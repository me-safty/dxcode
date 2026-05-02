import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  OpenCodeSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type { Schema } from "effect";
import { ClaudeAI, CursorIcon, type Icon, OpenAI, OpenCodeIcon } from "../Icons";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
};

export type ProviderSettingsControl = "text" | "password" | "textarea" | "switch";

export interface ProviderSettingsFieldUi {
  readonly control?: ProviderSettingsControl;
  readonly label?: string;
  readonly placeholder?: string;
  readonly description?: string;
  readonly hidden?: boolean;
  readonly clearWhenEmpty?: "omit" | "persist";
}

export interface ProviderSettingsUi {
  readonly order?: readonly string[];
  readonly fields?: Readonly<Record<string, ProviderSettingsFieldUi>>;
}

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema,
 * presentation metadata, and a small UI hint layer, then renders generically.
 */
export interface ProviderClientDefinition {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
  readonly settingsSchema: ProviderSettingsSchema;
  readonly settingsUi: ProviderSettingsUi;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

export const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: OpenAI,
    settingsSchema: CodexSettings,
    settingsUi: {
      order: ["binaryPath", "homePath", "shadowHomePath"],
      fields: {
        enabled: { hidden: true },
        customModels: { hidden: true },
        binaryPath: {
          placeholder: "codex",
          clearWhenEmpty: "omit",
        },
        homePath: {
          placeholder: "~/.codex",
          clearWhenEmpty: "omit",
        },
        shadowHomePath: {
          placeholder: "~/.codex-t3/personal",
          clearWhenEmpty: "omit",
        },
      },
    },
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: ClaudeAI,
    settingsSchema: ClaudeSettings,
    settingsUi: {
      order: ["binaryPath", "homePath", "launchArgs"],
      fields: {
        enabled: { hidden: true },
        customModels: { hidden: true },
        binaryPath: {
          placeholder: "claude",
          clearWhenEmpty: "omit",
        },
        homePath: {
          placeholder: "~",
          clearWhenEmpty: "omit",
        },
        launchArgs: {
          placeholder: "e.g. --chrome",
          clearWhenEmpty: "omit",
        },
      },
    },
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: "Early Access",
    settingsSchema: CursorSettings,
    settingsUi: {
      order: ["binaryPath", "apiEndpoint"],
      fields: {
        enabled: { hidden: true },
        customModels: { hidden: true },
        binaryPath: {
          placeholder: "agent",
          clearWhenEmpty: "omit",
        },
        apiEndpoint: {
          placeholder: "https://...",
          clearWhenEmpty: "omit",
        },
      },
    },
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: OpenCodeIcon,
    settingsSchema: OpenCodeSettings,
    settingsUi: {
      order: ["binaryPath", "serverUrl", "serverPassword"],
      fields: {
        enabled: { hidden: true },
        customModels: { hidden: true },
        binaryPath: {
          placeholder: "opencode",
          clearWhenEmpty: "omit",
        },
        serverUrl: {
          placeholder: "http://127.0.0.1:4096",
          clearWhenEmpty: "omit",
        },
        serverPassword: {
          control: "password",
          placeholder: "Optional",
          clearWhenEmpty: "omit",
        },
      },
    },
  },
];

export const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];
}
