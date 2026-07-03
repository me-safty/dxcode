import type { PluginId } from "@t3tools/contracts/plugin";
import type { SecretsCapability } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";

const keyPrefix = (pluginId: PluginId) => `plugin:${pluginId}:`;

export function makeSecretsCapability(input: {
  readonly pluginId: PluginId;
  readonly store: ServerSecretStore.ServerSecretStore["Service"];
  readonly config: ServerConfig.ServerConfig["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}): SecretsCapability {
  const prefix = keyPrefix(input.pluginId);
  const scoped = (name: string) => `${prefix}${name}`;

  return {
    get: (name) =>
      input.store.get(scoped(name)).pipe(
        Effect.map(
          Option.match({
            onNone: () => null,
            onSome: (value) => value,
          }),
        ),
      ),
    set: (name, value) => input.store.set(scoped(name), value),
    delete: (name) => input.store.remove(scoped(name)),
    list: input.fileSystem.readDirectory(input.config.secretsDir).pipe(
      Effect.map((entries) =>
        entries
          .filter((entry) => entry.endsWith(".bin"))
          .map((entry) => entry.slice(0, -".bin".length))
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length))
          .sort(),
      ),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(cause),
      ),
    ),
  };
}
