import {
  ClientSettingsSchema,
  EnvironmentId,
  type ClientSettings,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

interface ClientSettingsDocument {
  readonly settings: ClientSettings;
}

interface PersistedSavedEnvironmentStorageRecord extends Omit<
  PersistedSavedEnvironmentRecord,
  "desktopSsh"
> {
  readonly desktopSsh?: PersistedSavedEnvironmentRecord["desktopSsh"] | undefined;
  readonly encryptedBearerToken?: string | undefined;
}

interface SavedEnvironmentRegistryDocument {
  readonly records: readonly PersistedSavedEnvironmentStorageRecord[];
}

export interface DesktopSecretStorage {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
}

const ClientSettingsDocumentSchema = Schema.Struct({
  settings: ClientSettingsSchema,
});

const DesktopSshTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});

const PersistedSavedEnvironmentStorageRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optional(DesktopSshTargetSchema),
  encryptedBearerToken: Schema.optional(Schema.String),
});

const SavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  records: Schema.Array(PersistedSavedEnvironmentStorageRecordSchema),
});

const decodeClientSettingsDocumentJson = Schema.decodeEffect(
  Schema.fromJsonString(ClientSettingsDocumentSchema),
);
const encodeClientSettingsDocumentJson = Schema.encodeEffect(
  Schema.fromJsonString(ClientSettingsDocumentSchema),
);
const decodeSavedEnvironmentRegistryDocumentJson = Schema.decodeEffect(
  Schema.fromJsonString(SavedEnvironmentRegistryDocumentSchema),
);
const encodeSavedEnvironmentRegistryDocumentJson = Schema.encodeEffect(
  Schema.fromJsonString(SavedEnvironmentRegistryDocumentSchema),
);

function readJsonFileEffect<T>(
  filePath: string,
  decode: (raw: string) => Effect.Effect<T, unknown>,
): Effect.Effect<Option.Option<T>, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(Option.none<T>()),
      onSome: (value) =>
        decode(value).pipe(
          Effect.option,
          Effect.map((decoded) => decoded),
        ),
    });
  });
}

function writeJsonFileEffect<T>(
  filePath: string,
  value: T,
  encode: (value: T) => Effect.Effect<string, unknown>,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(filePath);
    const suffix = (yield* Random.nextUUIDv4).replace(/-/g, "");
    const tempPath = `${filePath}.${process.pid}.${suffix}.tmp`;
    const encoded = yield* encode(value);
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
    yield* fileSystem.rename(tempPath, filePath);
  });
}

function readSavedEnvironmentRegistryDocumentEffect(
  filePath: string,
): Effect.Effect<SavedEnvironmentRegistryDocument, never, FileSystem.FileSystem> {
  return readJsonFileEffect(filePath, decodeSavedEnvironmentRegistryDocumentJson).pipe(
    Effect.map(Option.getOrElse((): SavedEnvironmentRegistryDocument => ({ records: [] }))),
  );
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentStorageRecord,
): PersistedSavedEnvironmentRecord {
  const nextRecord = {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  return record.desktopSsh ? { ...nextRecord, desktopSsh: record.desktopSsh } : nextRecord;
}

export function readClientSettingsEffect(
  settingsPath: string,
): Effect.Effect<ClientSettings | null, never, FileSystem.FileSystem> {
  return readJsonFileEffect(settingsPath, decodeClientSettingsDocumentJson).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (document) => document.settings })),
  );
}

export function writeClientSettingsEffect(
  settingsPath: string,
  settings: ClientSettings,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> {
  return writeJsonFileEffect(
    settingsPath,
    { settings } satisfies ClientSettingsDocument,
    encodeClientSettingsDocumentJson,
  );
}

export function readSavedEnvironmentRegistryEffect(
  registryPath: string,
): Effect.Effect<readonly PersistedSavedEnvironmentRecord[], never, FileSystem.FileSystem> {
  return readSavedEnvironmentRegistryDocumentEffect(registryPath).pipe(
    Effect.map((document) =>
      document.records.map((record) => toPersistedSavedEnvironmentRecord(record)),
    ),
  );
}

export function writeSavedEnvironmentRegistryEffect(
  registryPath: string,
  records: readonly PersistedSavedEnvironmentRecord[],
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const currentDocument = yield* readSavedEnvironmentRegistryDocumentEffect(registryPath);
    const encryptedBearerTokenById = new Map(
      currentDocument.records.flatMap((record) =>
        record.encryptedBearerToken
          ? [[record.environmentId, record.encryptedBearerToken] as const]
          : [],
      ),
    );
    yield* writeJsonFileEffect(
      registryPath,
      {
        records: records.map((record) => {
          const encryptedBearerToken = encryptedBearerTokenById.get(record.environmentId);
          return encryptedBearerToken
            ? {
                environmentId: record.environmentId,
                label: record.label,
                httpBaseUrl: record.httpBaseUrl,
                wsBaseUrl: record.wsBaseUrl,
                createdAt: record.createdAt,
                lastConnectedAt: record.lastConnectedAt,
                ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
                encryptedBearerToken,
              }
            : record;
        }),
      } satisfies SavedEnvironmentRegistryDocument,
      encodeSavedEnvironmentRegistryDocumentJson,
    );
  });
}

export function readSavedEnvironmentSecretEffect(input: {
  readonly registryPath: string;
  readonly environmentId: string;
  readonly secretStorage: DesktopSecretStorage;
}): Effect.Effect<string | null, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const document = yield* readSavedEnvironmentRegistryDocumentEffect(input.registryPath);
    const encoded = document.records.find(
      (record) => record.environmentId === input.environmentId,
    )?.encryptedBearerToken;
    if (!encoded) {
      return null;
    }

    if (!input.secretStorage.isEncryptionAvailable()) {
      return null;
    }

    return yield* Effect.sync(() =>
      input.secretStorage.decryptString(Buffer.from(encoded, "base64")),
    ).pipe(Effect.catchDefect(() => Effect.succeed(null)));
  });
}

export function writeSavedEnvironmentSecretEffect(input: {
  readonly registryPath: string;
  readonly environmentId: string;
  readonly secret: string;
  readonly secretStorage: DesktopSecretStorage;
}): Effect.Effect<boolean, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const document = yield* readSavedEnvironmentRegistryDocumentEffect(input.registryPath);

    if (!input.secretStorage.isEncryptionAvailable()) {
      return false;
    }

    let found = false;

    yield* writeJsonFileEffect(
      input.registryPath,
      {
        records: document.records.map((record) => {
          if (record.environmentId !== input.environmentId) {
            return record;
          }

          found = true;
          const encryptedBearerToken = input.secretStorage
            .encryptString(input.secret)
            .toString("base64");
          const nextRecord = {
            environmentId: record.environmentId,
            label: record.label,
            httpBaseUrl: record.httpBaseUrl,
            wsBaseUrl: record.wsBaseUrl,
            createdAt: record.createdAt,
            lastConnectedAt: record.lastConnectedAt,
            encryptedBearerToken,
          };
          return record.desktopSsh
            ? {
                environmentId: nextRecord.environmentId,
                label: nextRecord.label,
                httpBaseUrl: nextRecord.httpBaseUrl,
                wsBaseUrl: nextRecord.wsBaseUrl,
                createdAt: nextRecord.createdAt,
                lastConnectedAt: nextRecord.lastConnectedAt,
                encryptedBearerToken: nextRecord.encryptedBearerToken,
                desktopSsh: record.desktopSsh,
              }
            : nextRecord;
        }),
      } satisfies SavedEnvironmentRegistryDocument,
      encodeSavedEnvironmentRegistryDocumentJson,
    );
    return found;
  });
}

export function removeSavedEnvironmentSecretEffect(input: {
  readonly registryPath: string;
  readonly environmentId: string;
}): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const document = yield* readSavedEnvironmentRegistryDocumentEffect(input.registryPath);
    if (
      !document.records.some(
        (record) =>
          record.environmentId === input.environmentId && record.encryptedBearerToken !== undefined,
      )
    ) {
      return;
    }

    yield* writeJsonFileEffect(
      input.registryPath,
      {
        records: document.records.map((record) => {
          if (record.environmentId !== input.environmentId) {
            return record;
          }

          return toPersistedSavedEnvironmentRecord(record);
        }),
      } satisfies SavedEnvironmentRegistryDocument,
      encodeSavedEnvironmentRegistryDocumentJson,
    );
  });
}
