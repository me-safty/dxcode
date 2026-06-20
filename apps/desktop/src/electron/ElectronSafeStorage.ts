import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { safeStorage } from "electron";

const ElectronSafeStorageOperation = Schema.Literals([
  "check encryption availability",
  "encrypt a string",
  "decrypt a string",
]);

export class ElectronSafeStorageError extends Schema.TaggedErrorClass<ElectronSafeStorageError>()(
  "ElectronSafeStorageError",
  {
    operation: ElectronSafeStorageOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron safe storage failed to ${this.operation}.`;
  }
}

export class ElectronSafeStorage extends Context.Service<
  ElectronSafeStorage,
  {
    readonly isEncryptionAvailable: Effect.Effect<boolean, ElectronSafeStorageError>;
    readonly encryptString: (value: string) => Effect.Effect<Uint8Array, ElectronSafeStorageError>;
    readonly decryptString: (value: Uint8Array) => Effect.Effect<string, ElectronSafeStorageError>;
  }
>()("@t3tools/desktop/electron/ElectronSafeStorage") {}

export const make = ElectronSafeStorage.of({
  isEncryptionAvailable: Effect.try({
    try: () => safeStorage.isEncryptionAvailable(),
    catch: (cause) =>
      new ElectronSafeStorageError({ operation: "check encryption availability", cause }),
  }),
  encryptString: (value) =>
    Effect.try({
      try: () => safeStorage.encryptString(value),
      catch: (cause) => new ElectronSafeStorageError({ operation: "encrypt a string", cause }),
    }),
  decryptString: (value) =>
    Effect.try({
      try: () => safeStorage.decryptString(Buffer.from(value)),
      catch: (cause) => new ElectronSafeStorageError({ operation: "decrypt a string", cause }),
    }),
});

export const layer = Layer.succeed(ElectronSafeStorage, make);
