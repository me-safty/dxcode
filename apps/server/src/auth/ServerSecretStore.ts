import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

const SecretStoreOperation = Schema.Literals([
  "secure",
  "read",
  "create_temporary_path",
  "persist",
  "generate_random",
  "read_after_concurrent_creation",
  "remove",
  "decode",
  "encode",
]);

export class SecretStoreError extends Schema.TaggedErrorClass<SecretStoreError>()(
  "SecretStoreError",
  {
    operation: SecretStoreOperation,
    resource: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Secret store operation '${this.operation}' failed for ${this.resource}.`;
  }
}

export const isSecretStoreError = Schema.is(SecretStoreError);

const isPlatformError = (value: unknown): value is PlatformError.PlatformError =>
  Predicate.isTagged(value, "PlatformError");

export const isSecretAlreadyExistsError = (error: SecretStoreError): boolean =>
  isPlatformError(error.cause) && error.cause.reason._tag === "AlreadyExists";

export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    readonly get: (name: string) => Effect.Effect<Option.Option<Uint8Array>, SecretStoreError>;
    readonly set: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly create: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
    readonly remove: (name: string) => Effect.Effect<void, SecretStoreError>;
  }
>()("t3/auth/ServerSecretStore") {}

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreError({
          operation: "secure",
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (name: string) => path.join(serverConfig.secretsDir, `${name}.bin`);

  const get: ServerSecretStore["Service"]["get"] = (name) =>
    fileSystem.readFile(resolveSecretPath(name)).pipe(
      Effect.map((bytes) => Option.some(Uint8Array.from(bytes))),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none())
          : Effect.fail(
              new SecretStoreError({
                operation: "read",
                resource: `secret ${name}`,
                cause,
              }),
            ),
      ),
      Effect.withSpan("ServerSecretStore.get"),
    );

  const set: ServerSecretStore["Service"]["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreError({
            operation: "create_temporary_path",
            resource: `secret ${name}`,
            cause,
          }),
      ),
      Effect.flatMap((uuid) => {
        const tempPath = `${secretPath}.${uuid}.tmp`;
        return Effect.gen(function* () {
          yield* fileSystem.writeFile(tempPath, value);
          yield* fileSystem.chmod(tempPath, 0o600);
          yield* fileSystem.rename(tempPath, secretPath);
          yield* fileSystem.chmod(secretPath, 0o600);
        }).pipe(
          Effect.catch((cause) =>
            fileSystem.remove(tempPath).pipe(
              Effect.ignore,
              Effect.flatMap(() =>
                Effect.fail(
                  new SecretStoreError({
                    operation: "persist",
                    resource: `secret ${name}`,
                    cause,
                  }),
                ),
              ),
            ),
          ),
        );
      }),
      Effect.withSpan("ServerSecretStore.set"),
    );
  };

  const create: ServerSecretStore["Service"]["create"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(secretPath, {
          flag: "wx",
          mode: 0o600,
        });
        yield* file.writeAll(value);
        yield* file.sync;
        yield* fileSystem.chmod(secretPath, 0o600);
      }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreError({
            operation: "persist",
            resource: `secret ${name}`,
            cause,
          }),
      ),
    );
  };

  const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            crypto.randomBytes(bytes).pipe(
              Effect.mapError(
                (cause) =>
                  new SecretStoreError({
                    operation: "generate_random",
                    resource: `secret ${name}`,
                    cause,
                  }),
              ),
              Effect.flatMap((generated) =>
                create(name, generated).pipe(
                  Effect.as(Uint8Array.from(generated)),
                  Effect.catchIf(isSecretStoreError, (error) =>
                    isSecretAlreadyExistsError(error)
                      ? get(name).pipe(
                          Effect.flatMap(
                            Option.match({
                              onSome: Effect.succeed,
                              onNone: () =>
                                Effect.fail(
                                  new SecretStoreError({
                                    operation: "read_after_concurrent_creation",
                                    resource: `secret ${name}`,
                                  }),
                                ),
                            }),
                          ),
                        )
                      : Effect.fail(error),
                  ),
                ),
              ),
            ),
        }),
      ),
      Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
    );

  const remove: ServerSecretStore["Service"]["remove"] = (name) =>
    fileSystem.remove(resolveSecretPath(name)).pipe(
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.void
          : Effect.fail(
              new SecretStoreError({
                operation: "remove",
                resource: `secret ${name}`,
                cause,
              }),
            ),
      ),
      Effect.withSpan("ServerSecretStore.remove"),
    );

  return ServerSecretStore.of({
    get,
    set,
    create,
    getOrCreateRandom,
    remove,
  });
});

export const layer = Layer.effect(ServerSecretStore, make);
