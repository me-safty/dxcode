import type { DesktopServerExposureMode, DesktopUpdateChannel } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

import { resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly tailscaleServeEnabled: boolean;
  readonly tailscaleServePort: number;
  readonly updateChannel: DesktopUpdateChannel;
  readonly updateChannelConfiguredByUser: boolean;
}

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  tailscaleServeEnabled: false,
  tailscaleServePort: DEFAULT_TAILSCALE_SERVE_PORT,
  updateChannel: "latest",
  updateChannelConfiguredByUser: false,
};

const DesktopSettingsDocument = Schema.Struct({
  serverExposureMode: Schema.optional(Schema.Literals(["local-only", "network-accessible"])),
  tailscaleServeEnabled: Schema.optional(Schema.Boolean),
  tailscaleServePort: Schema.optional(Schema.Number),
  updateChannel: Schema.optional(Schema.Literals(["latest", "nightly"])),
  updateChannelConfiguredByUser: Schema.optional(Schema.Boolean),
});

type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;

const decodeDesktopSettingsJson = Schema.decodeEffect(
  Schema.fromJsonString(DesktopSettingsDocument),
);
const encodeDesktopSettingsJson = Schema.encodeEffect(
  Schema.fromJsonString(DesktopSettingsDocument),
);

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function setDesktopTailscaleServePreference(
  settings: DesktopSettings,
  input: { readonly enabled: boolean; readonly port?: number },
): DesktopSettings {
  const port =
    input.port === undefined
      ? settings.tailscaleServePort
      : normalizeTailscaleServePort(input.port);
  return settings.tailscaleServeEnabled === input.enabled && settings.tailscaleServePort === port
    ? settings
    : {
        ...settings,
        tailscaleServeEnabled: input.enabled,
        tailscaleServePort: port,
      };
}

export function normalizeTailscaleServePort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : DEFAULT_TAILSCALE_SERVE_PORT;
}

export function setDesktopUpdateChannelPreference(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return {
    ...settings,
    updateChannel: requestedChannel,
    updateChannelConfiguredByUser: true,
  };
}

function normalizeDesktopSettingsDocument(
  parsed: DesktopSettingsDocument,
  appVersion: string,
): DesktopSettings {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);
  const parsedUpdateChannel = Option.fromNullishOr(parsed.updateChannel);
  const isLegacySettings = parsed.updateChannelConfiguredByUser === undefined;
  const updateChannelConfiguredByUser =
    parsed.updateChannelConfiguredByUser === true ||
    (isLegacySettings && Option.contains(parsedUpdateChannel, "nightly"));

  return {
    serverExposureMode:
      parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
    tailscaleServeEnabled: parsed.tailscaleServeEnabled === true,
    tailscaleServePort: normalizeTailscaleServePort(parsed.tailscaleServePort),
    updateChannel: updateChannelConfiguredByUser
      ? Option.getOrElse(parsedUpdateChannel, () => defaultSettings.updateChannel)
      : defaultSettings.updateChannel,
    updateChannelConfiguredByUser,
  };
}

export function readDesktopSettingsEffect(
  settingsPath: string,
  appVersion: string,
): Effect.Effect<DesktopSettings, never, FileSystem.FileSystem> {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(settingsPath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(defaultSettings),
      onSome: (value) =>
        decodeDesktopSettingsJson(value).pipe(
          Effect.map((parsed) => normalizeDesktopSettingsDocument(parsed, appVersion)),
          Effect.catch(() => Effect.succeed(defaultSettings)),
        ),
    });
  });
}

export function writeDesktopSettingsEffect(
  settingsPath: string,
  settings: DesktopSettings,
): Effect.Effect<void, PlatformError | Schema.SchemaError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(settingsPath);
    const suffix = (yield* Random.nextUUIDv4).replace(/-/g, "");
    const tempPath = `${settingsPath}.${process.pid}.${suffix}.tmp`;
    const encoded = yield* encodeDesktopSettingsJson(settings);
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
    yield* fileSystem.rename(tempPath, settingsPath);
  });
}
