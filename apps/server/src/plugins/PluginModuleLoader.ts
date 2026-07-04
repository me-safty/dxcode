import type { PluginDefinition } from "@t3tools/plugin-sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeURL from "node:url";

import * as ServerConfig from "../config.ts";

export class PluginModuleLoadError extends Schema.TaggedErrorClass<PluginModuleLoadError>()(
  "PluginModuleLoadError",
  { pluginDir: Schema.String, entry: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not load plugin server entry ${this.entry} from ${this.pluginDir}.`;
  }
}

export class PluginModulePathError extends Schema.TaggedErrorClass<PluginModulePathError>()(
  "PluginModulePathError",
  { pluginDir: Schema.String, entry: Schema.String, resolvedPath: Schema.String },
) {
  override get message(): string {
    return `Plugin server entry ${this.entry} resolves outside ${this.pluginDir}.`;
  }
}

export class PluginModuleShapeError extends Schema.TaggedErrorClass<PluginModuleShapeError>()(
  "PluginModuleShapeError",
  { pluginDir: Schema.String, entry: Schema.String },
) {
  override get message(): string {
    return `Plugin server entry ${this.entry} does not default-export a definePlugin-shaped object.`;
  }
}

export type PluginModuleLoaderError =
  | PluginModuleLoadError
  | PluginModulePathError
  | PluginModuleShapeError;

export class PluginModuleLoader extends Context.Service<
  PluginModuleLoader,
  {
    readonly ensureHostSingletonResolution: Effect.Effect<void>;
    readonly loadServerEntry: (
      pluginDir: string,
      entryRelPath: string,
    ) => Effect.Effect<PluginDefinition, PluginModuleLoaderError>;
  }
>()("t3/plugins/PluginModuleLoader") {}

let hostResolutionHookRegistered = false;

function isPluginDefinition(value: unknown): value is PluginDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "register" in value &&
    typeof (value as { readonly register?: unknown }).register === "function"
  );
}

function isInside(parent: string, child: string, separator: string): boolean {
  return (
    child === parent ||
    child.startsWith(parent.endsWith(separator) ? parent : `${parent}${separator}`)
  );
}

export const make = Effect.fn("PluginModuleLoader.make")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const ensureHostSingletonResolution = Effect.gen(function* () {
    if (hostResolutionHookRegistered) return;
    hostResolutionHookRegistered = true;
    const nodeModule = yield* Effect.promise(() => import("node:module"));
    if (typeof nodeModule.register !== "function") {
      yield* Effect.logWarning(
        "Node module.register is unavailable; plugin host singleton resolution is disabled",
      );
      return;
    }
    // The loader hook must be its own module file (it runs in a loader-hook
    // worker, loaded by URL), so it cannot be inlined into bin.mjs. It ships next
    // to this file in source (./pluginResolveHooks.ts) and next to bin.mjs in the
    // bundle (./plugins/pluginResolveHooks.mjs, emitted as a second pack entry).
    // Register whichever exists so host-singleton resolution works in both the
    // source server (dev) and the bundled server (desktop / production).
    const hookCandidates = [
      new URL("./plugins/pluginResolveHooks.mjs", import.meta.url),
      new URL("./pluginResolveHooks.mjs", import.meta.url),
      new URL("./pluginResolveHooks.ts", import.meta.url),
    ];
    let hookUrl: URL | undefined;
    for (const candidate of hookCandidates) {
      const present = yield* fs
        .exists(NodeURL.fileURLToPath(candidate))
        .pipe(Effect.orElseSucceed(() => false));
      if (present) {
        hookUrl = candidate;
        break;
      }
    }
    if (hookUrl === undefined) {
      yield* Effect.logWarning(
        "Plugin host singleton resolution hook module was not found; plugin host singleton resolution is disabled",
      );
      return;
    }
    const registeredHookUrl = hookUrl;
    yield* Effect.sync(() =>
      nodeModule.register(registeredHookUrl, {
        parentURL: import.meta.url,
        data: {
          pluginsRootUrl: NodeURL.pathToFileURL(config.pluginsDir).href,
          // A host module URL used as the resolution anchor inside the loader-hook
          // worker: `import.meta.resolve` is unavailable there, so the hook resolves
          // shared `effect`/SDK specifiers by delegating to `nextResolve` from this
          // host parent (which finds the host's node_modules), keeping plugins on the
          // host's singleton instances.
          hostAnchorUrl: import.meta.url,
        },
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to register plugin host singleton resolution hook", {
          cause,
        }),
      ),
    );
  });

  const loadServerEntry: PluginModuleLoader["Service"]["loadServerEntry"] = (
    pluginDir,
    entryRelPath,
  ) =>
    Effect.gen(function* () {
      const realPluginDir = yield* fs
        .realPath(pluginDir)
        .pipe(
          Effect.mapError(
            (cause) => new PluginModuleLoadError({ pluginDir, entry: entryRelPath, cause }),
          ),
        );
      const resolvedEntry = path.resolve(realPluginDir, entryRelPath);
      const realEntry = yield* fs
        .realPath(resolvedEntry)
        .pipe(
          Effect.mapError(
            (cause) => new PluginModuleLoadError({ pluginDir, entry: entryRelPath, cause }),
          ),
        );
      if (!isInside(realPluginDir, realEntry, path.sep)) {
        return yield* new PluginModulePathError({
          pluginDir,
          entry: entryRelPath,
          resolvedPath: realEntry,
        });
      }
      const imported = yield* Effect.tryPromise({
        try: () => import(NodeURL.pathToFileURL(realEntry).href),
        catch: (cause) => new PluginModuleLoadError({ pluginDir, entry: entryRelPath, cause }),
      });
      if (!isPluginDefinition(imported.default)) {
        return yield* new PluginModuleShapeError({ pluginDir, entry: entryRelPath });
      }
      return imported.default;
    });

  return PluginModuleLoader.of({ ensureHostSingletonResolution, loadServerEntry });
});

export const layer = Layer.effect(PluginModuleLoader, make());
