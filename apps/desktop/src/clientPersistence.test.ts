import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ClientSettings,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  readClientSettingsEffect,
  readSavedEnvironmentRegistryEffect,
  readSavedEnvironmentSecretEffect,
  removeSavedEnvironmentSecretEffect,
  writeClientSettingsEffect,
  writeSavedEnvironmentRegistryEffect,
  writeSavedEnvironmentSecretEffect,
  type DesktopSecretStorage,
} from "./clientPersistence.ts";

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

const decodeSavedEnvironmentRegistryDocument = Schema.decodeEffect(
  Schema.fromJsonString(SavedEnvironmentRegistryDocumentSchema),
);

function makeTempPath(fileName: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-client-persistence-test-",
    });
    return path.join(directory, fileName);
  });
}

function readRegistryDocument(filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(filePath);
    return yield* decodeSavedEnvironmentRegistryDocument(raw);
  });
}

function makeSecretStorage(available: boolean): DesktopSecretStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("enc:")) {
        throw new Error("invalid secret");
      }
      return decoded.slice("enc:".length);
    },
  };
}

const clientSettings: ClientSettings = {
  autoOpenPlanSidebar: false,
  confirmThreadArchive: true,
  confirmThreadDelete: false,
  dismissedProviderUpdateNotificationKeys: [],
  diffIgnoreWhitespace: true,
  diffWordWrap: true,
  favorites: [],
  providerModelPreferences: {},
  sidebarProjectGroupingMode: "repository_path",
  sidebarProjectGroupingOverrides: {
    "environment-1:/tmp/project-a": "separate",
  },
  sidebarProjectSortOrder: "manual",
  sidebarThreadSortOrder: "created_at",
  timestampFormat: "24-hour",
};

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: "2026-04-09T01:00:00.000Z",
  desktopSsh: {
    alias: "devbox",
    hostname: "devbox.example.com",
    username: "julius",
    port: 22,
  },
};

describe("clientPersistence", () => {
  it.effect("persists and reloads client settings", () =>
    Effect.gen(function* () {
      const settingsPath = yield* makeTempPath("client-settings.json");

      yield* writeClientSettingsEffect(settingsPath, clientSettings);

      const settings = yield* readClientSettingsEffect(settingsPath);
      assert.deepEqual(settings, clientSettings);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("persists and reloads saved environment metadata", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      const records = yield* readSavedEnvironmentRegistryEffect(registryPath);
      assert.deepEqual(records, [savedRegistryRecord]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("persists encrypted saved environment secrets when encryption is available", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      const written = yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      });
      assert.equal(written, true);

      const secret = yield* readSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      });
      assert.equal(secret, "bearer-token");

      const document = yield* readRegistryDocument(registryPath);
      assert.deepEqual(document, {
        records: [
          {
            ...savedRegistryRecord,
            encryptedBearerToken: Buffer.from("enc:bearer-token", "utf8").toString("base64"),
          },
        ],
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("preserves existing secrets when encryption is unavailable", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");
      const availableSecretStorage = makeSecretStorage(true);

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage: availableSecretStorage,
      });

      const written = yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "next-token",
        secretStorage: makeSecretStorage(false),
      });
      assert.equal(written, false);

      const secret = yield* readSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: availableSecretStorage,
      });
      assert.equal(secret, "bearer-token");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("removes saved environment secrets", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      });

      yield* removeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
      });

      const secret = yield* readSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      });
      assert.equal(secret, null);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("treats malformed secrets documents as empty", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const registryPath = yield* makeTempPath("saved-environments.json");
      yield* fs.writeFileString(registryPath, "{}\n");

      const secret = yield* readSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: makeSecretStorage(true),
      });
      assert.equal(secret, null);

      yield* removeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("returns false when writing a secret without metadata", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");

      const written = yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage: makeSecretStorage(true),
      });
      assert.equal(written, false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("preserves encrypted secrets when metadata is rewritten", () =>
    Effect.gen(function* () {
      const registryPath = yield* makeTempPath("saved-environments.json");
      const secretStorage = makeSecretStorage(true);

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      yield* writeSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      });

      yield* writeSavedEnvironmentRegistryEffect(registryPath, [savedRegistryRecord]);

      const records = yield* readSavedEnvironmentRegistryEffect(registryPath);
      assert.deepEqual(records, [savedRegistryRecord]);
      const secret = yield* readSavedEnvironmentSecretEffect({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      });
      assert.equal(secret, "bearer-token");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
