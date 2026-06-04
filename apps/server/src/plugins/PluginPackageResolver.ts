import { PluginManifest } from "@t3tools/contracts";
import {
  isPluginApiVersionCompatible,
  PluginPackageJson,
  type LoadedServerPlugin,
  type PluginPackageDescriptor,
} from "@t3tools/plugin-api/package";
import type { ServerPlugin } from "@t3tools/plugin-api/server";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { pathToFileURL } from "node:url";

import { ServerConfig } from "../config.ts";

const decodePluginPackageJson = Schema.decodeUnknownEffect(PluginPackageJson);
const decodePluginManifest = Schema.decodeUnknownEffect(PluginManifest);
const decodeUnknownJsonString = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

class PluginPackageResolverError extends Data.TaggedError("PluginPackageResolverError")<{
  readonly message: string;
  readonly packageRoot?: string;
  readonly cause?: unknown;
}> {}

export interface PluginPackageResolverShape {
  readonly discover: Effect.Effect<ReadonlyArray<LoadedServerPlugin>>;
  readonly discoverFromDirectory: (
    pluginsDir: string,
  ) => Effect.Effect<ReadonlyArray<LoadedServerPlugin>>;
}

export class PluginPackageResolver extends Context.Service<
  PluginPackageResolver,
  PluginPackageResolverShape
>()("t3/plugins/PluginPackageResolver") {}

function parseJson(text: string, packageRoot: string) {
  return decodeUnknownJsonString(text).pipe(
    Effect.mapError(
      (cause) =>
        new PluginPackageResolverError({
          message: "Plugin package JSON could not be parsed.",
          packageRoot,
          cause,
        }),
    ),
  );
}

function extractServerPlugin(module: unknown, packageRoot: string): ServerPlugin {
  if (typeof module !== "object" || module === null) {
    throw new PluginPackageResolverError({
      message: "Plugin server entry did not export an object.",
      packageRoot,
    });
  }

  const exports = module as {
    readonly default?: unknown;
    readonly plugin?: unknown;
    readonly serverPlugin?: unknown;
  };
  const candidate = exports.default ?? exports.plugin ?? exports.serverPlugin;
  if (typeof candidate !== "object" || candidate === null) {
    throw new PluginPackageResolverError({
      message:
        "Plugin server entry must export a ServerPlugin as default, plugin, or serverPlugin.",
      packageRoot,
    });
  }

  const serverPlugin = candidate as {
    readonly manifest?: unknown;
    readonly activate?: unknown;
  };
  if (
    typeof serverPlugin.manifest !== "object" ||
    serverPlugin.manifest === null ||
    typeof serverPlugin.activate !== "function"
  ) {
    throw new PluginPackageResolverError({
      message:
        "Plugin server entry must export a ServerPlugin as default, plugin, or serverPlugin.",
      packageRoot,
    });
  }

  return candidate as ServerPlugin;
}

const resolveInsidePackage = (
  packageRoot: string,
  relativePath: string,
): Effect.Effect<string, PluginPackageResolverError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const resolved = path.resolve(packageRoot, relativePath);
    const relative = path.relative(packageRoot, resolved);
    const escapesPackage =
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith("../") ||
      relative.startsWith("..\\");

    if (escapesPackage) {
      return yield* new PluginPackageResolverError({
        message: `Plugin path escapes package root: ${relativePath}.`,
        packageRoot,
      });
    }

    return resolved;
  });

export const loadPluginPackage = (
  packageRoot: string,
): Effect.Effect<
  LoadedServerPlugin,
  PluginPackageResolverError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJson = yield* fs.readFileString(packageJsonPath).pipe(
      Effect.mapError(
        (cause) =>
          new PluginPackageResolverError({
            message: "Plugin package.json could not be read.",
            packageRoot,
            cause,
          }),
      ),
      Effect.flatMap((text) => parseJson(text, packageRoot)),
      Effect.flatMap((json) =>
        decodePluginPackageJson(json).pipe(
          Effect.mapError(
            (cause) =>
              new PluginPackageResolverError({
                message: "Plugin package.json does not match the T3 plugin package schema.",
                packageRoot,
                cause,
              }),
          ),
        ),
      ),
    );

    if (!isPluginApiVersionCompatible(packageJson.t3Plugin.apiVersion)) {
      return yield* new PluginPackageResolverError({
        message: `Plugin API version ${packageJson.t3Plugin.apiVersion} is not compatible with this host.`,
        packageRoot,
      });
    }

    const manifestPath = yield* resolveInsidePackage(packageRoot, packageJson.t3Plugin.manifest);
    const serverEntryPath = yield* resolveInsidePackage(packageRoot, packageJson.t3Plugin.server);
    const clientEntryPath = yield* resolveInsidePackage(packageRoot, packageJson.t3Plugin.client);

    const manifest = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError(
        (cause) =>
          new PluginPackageResolverError({
            message: "Plugin manifest could not be read.",
            packageRoot,
            cause,
          }),
      ),
      Effect.flatMap((text) => parseJson(text, packageRoot)),
      Effect.flatMap((json) =>
        decodePluginManifest(json).pipe(
          Effect.mapError(
            (cause) =>
              new PluginPackageResolverError({
                message: "Plugin manifest does not match the plugin manifest schema.",
                packageRoot,
                cause,
              }),
          ),
        ),
      ),
    );

    if (manifest.id !== packageJson.t3Plugin.id) {
      return yield* new PluginPackageResolverError({
        message: `Plugin manifest id ${manifest.id} does not match package id ${packageJson.t3Plugin.id}.`,
        packageRoot,
      });
    }

    const descriptor: PluginPackageDescriptor = {
      pluginId: manifest.id,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      packageRoot,
      apiVersion: packageJson.t3Plugin.apiVersion,
      manifestPath,
      serverEntryPath,
      clientEntryPath,
    };

    const module = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(serverEntryPath).href) as Promise<unknown>,
      catch: (cause) =>
        new PluginPackageResolverError({
          message: "Plugin server entry could not be imported.",
          packageRoot,
          cause,
        }),
    });
    const serverPlugin = yield* Effect.try({
      try: () => extractServerPlugin(module, packageRoot),
      catch: (cause) =>
        cause instanceof PluginPackageResolverError
          ? cause
          : new PluginPackageResolverError({
              message: "Plugin server entry export could not be resolved.",
              packageRoot,
              cause,
            }),
    });

    if (serverPlugin.manifest.id !== manifest.id) {
      return yield* new PluginPackageResolverError({
        message: `Plugin server manifest id ${serverPlugin.manifest.id} does not match package id ${manifest.id}.`,
        packageRoot,
      });
    }

    return {
      descriptor,
      manifest,
      serverPlugin,
    };
  });

const makePluginPackageResolver = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;

  const loadPackageWithServices = (packageRoot: string) =>
    loadPluginPackage(packageRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const discoverFromDirectory: PluginPackageResolverShape["discoverFromDirectory"] = (pluginsDir) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(pluginsDir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return [];
      }

      const entries = yield* fs.readDirectory(pluginsDir).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Plugin directory could not be read", {
            pluginsDir,
            cause,
          }).pipe(Effect.as([])),
        ),
      );
      const loaded: Array<LoadedServerPlugin> = [];
      for (const entry of entries.toSorted()) {
        const discoveredPackageRoot = path.join(pluginsDir, entry);
        const stat = yield* fs
          .stat(discoveredPackageRoot)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (stat?.type !== "Directory" && stat?.type !== "SymbolicLink") {
          continue;
        }
        const packageRoot = yield* fs
          .realPath(discoveredPackageRoot)
          .pipe(Effect.catch(() => Effect.succeed(discoveredPackageRoot)));
        const plugin = yield* loadPackageWithServices(packageRoot).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Plugin package could not be loaded", {
              packageRoot: discoveredPackageRoot,
              message: cause.message,
              cause,
            }).pipe(Effect.as(null)),
          ),
        );
        if (plugin !== null) {
          loaded.push(plugin);
        }
      }
      return loaded;
    });

  return PluginPackageResolver.of({
    discover: discoverFromDirectory(path.join(config.baseDir, "plugins")),
    discoverFromDirectory,
  });
});

export const PluginPackageResolverLive = Layer.effect(
  PluginPackageResolver,
  makePluginPackageResolver,
);
