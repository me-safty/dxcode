import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

const clientSettingsFieldDecoders = Object.fromEntries(
  Object.entries(ClientSettingsSchema.fields).map(([key, schema]) => [
    key,
    Schema.decodeUnknownSync(schema),
  ]),
) as Record<keyof ClientSettings, (value: unknown) => unknown>;

export function parseClientSettings(raw: unknown): ClientSettings | null {
  try {
    return decodeClientSettings(raw);
  } catch {
    return null;
  }
}

export function normalizeClientSettings(raw: unknown): ClientSettings | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const rawRecord = raw as Record<string, unknown>;
  const partialSettings: Partial<Record<keyof ClientSettings, unknown>> = {};
  for (const [key, decode] of Object.entries(clientSettingsFieldDecoders) as Array<
    [keyof ClientSettings, (value: unknown) => unknown]
  >) {
    const value = rawRecord[key];
    if (value === undefined) {
      continue;
    }

    try {
      partialSettings[key] = decode(value);
    } catch {
      // Drop invalid fields so schema defaults can recover them.
    }
  }

  return parseClientSettings(partialSettings);
}
