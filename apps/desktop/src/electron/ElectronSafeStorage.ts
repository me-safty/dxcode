import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { safeStorage } from "electron";

export class ElectronSafeStorageAvailabilityError extends Schema.TaggedErrorClass<ElectronSafeStorageAvailabilityError>()(
  "ElectronSafeStorageAvailabilityError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return `Electron safe storage failed to check encryption availability (${String(this.cause)}).`;
  }
}

export class ElectronSafeStorageEncryptError extends Schema.TaggedErrorClass<ElectronSafeStorageEncryptError>()(
  "ElectronSafeStorageEncryptError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return `Electron safe storage failed to encrypt a string (${String(this.cause)}).`;
  }
}

export class ElectronSafeStorageDecryptError extends Schema.TaggedErrorClass<ElectronSafeStorageDecryptError>()(
  "ElectronSafeStorageDecryptError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return `Electron safe storage failed to decrypt a string (${String(this.cause)}).`;
  }
}

export class ElectronSafeStorage extends Context.Service<
  ElectronSafeStorage,
  {
    readonly isEncryptionAvailable: Effect.Effect<boolean, ElectronSafeStorageAvailabilityError>;
    readonly encryptString: (
      value: string,
    ) => Effect.Effect<Uint8Array, ElectronSafeStorageEncryptError>;
    readonly decryptString: (
      value: Uint8Array,
    ) => Effect.Effect<string, ElectronSafeStorageDecryptError>;
  }
>()("@t3tools/desktop/electron/ElectronSafeStorage") {}

export const make = ElectronSafeStorage.of({
  isEncryptionAvailable: Effect.try({
    try: () => safeStorage.isEncryptionAvailable(),
    catch: (cause) => new ElectronSafeStorageAvailabilityError({ cause }),
  }),
  encryptString: (value) =>
    Effect.try({
      try: () => safeStorage.encryptString(value),
      catch: (cause) => new ElectronSafeStorageEncryptError({ cause }),
    }),
  decryptString: (value) =>
    Effect.try({
      try: () => safeStorage.decryptString(Buffer.from(value)),
      catch: (cause) => new ElectronSafeStorageDecryptError({ cause }),
    }),
});

export const layer = Layer.succeed(ElectronSafeStorage, make);
