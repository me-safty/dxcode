import * as NodeServices from "@effect/platform-node/NodeServices";
import { PluginId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import {
  loadPluginPackage,
  PluginPackageResolver,
  PluginPackageResolverLive,
} from "./PluginPackageResolver.ts";

const platformLayer = Layer.mergeAll(
  NodeServices.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-plugin-resolver-test-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);
const layer = it.layer(
  Layer.mergeAll(PluginPackageResolverLive.pipe(Layer.provide(platformLayer)), platformLayer),
);
const encodeUnknownJsonString = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);
const AUTOMATIONS_PLUGIN_ID = "t3.automations";

function writePluginPackage(input: { readonly packageRoot: string; readonly manifest: unknown }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* fs.makeDirectory(input.packageRoot, { recursive: true });
    yield* fs.writeFileString(
      path.join(input.packageRoot, "package.json"),
      yield* encodeUnknownJsonString({
        name: "@t3tools/plugin-test",
        version: "0.0.1",
        t3Plugin: {
          id: "t3.test",
          apiVersion: "^0.0.24",
          manifest: "./manifest.json",
          server: "./server.js",
          client: "./client.js",
        },
      }),
    );
    yield* fs.writeFileString(
      path.join(input.packageRoot, "manifest.json"),
      yield* encodeUnknownJsonString(input.manifest),
    );
  });
}

layer("PluginPackageResolver", (it) => {
  it.effect("discovers the externalized Automations package from a plugins directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig;
      const resolver = yield* PluginPackageResolver;
      const pluginsDir = path.join(config.baseDir, "plugins");
      const packageRoot = path.resolve(
        import.meta.dirname,
        "../../../../packages/plugins/automations",
      );

      yield* fs.makeDirectory(pluginsDir, { recursive: true });
      assert.isTrue(yield* fs.exists(path.join(packageRoot, "package.json")));
      yield* fs.symlink(packageRoot, path.join(pluginsDir, AUTOMATIONS_PLUGIN_ID));
      const installedPackageRoot = path.join(pluginsDir, AUTOMATIONS_PLUGIN_ID);
      assert.isTrue(yield* fs.exists(path.join(installedPackageRoot, "package.json")));
      yield* loadPluginPackage(packageRoot);

      const plugins = yield* resolver.discoverFromDirectory(pluginsDir);
      const plugin = plugins[0];

      assert.equal(plugins.length, 1);
      assert.equal(plugin?.manifest.id, PluginId.make(AUTOMATIONS_PLUGIN_ID));
      assert.equal(plugin?.descriptor.pluginId, PluginId.make(AUTOMATIONS_PLUGIN_ID));
      assert.equal(plugin?.descriptor.packageName, "@t3tools/plugin-automations");
      assert.equal(plugin?.descriptor.packageRoot, packageRoot);
      assert.equal(plugin?.manifest.name, "Automations");
      assert.isFunction(plugin?.serverPlugin.activate);
      assert.isTrue(plugin?.descriptor.clientEntryPath.endsWith("dist/client.iife.js"));
    }),
  );

  it.effect("skips invalid package entries without failing discovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const resolver = yield* PluginPackageResolver;
      const pluginsDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-plugin-resolver-invalid-",
      });
      const packageRoot = path.join(pluginsDir, "bad-plugin");

      yield* fs.makeDirectory(packageRoot, { recursive: true });
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        yield* encodeUnknownJsonString({
          name: "@t3tools/plugin-bad",
          version: "0.0.1",
          t3Plugin: {
            id: "t3.bad",
            apiVersion: "^0.0.24",
            manifest: "../manifest.json",
            server: "./server.js",
            client: "./client.js",
          },
        }),
      );

      const plugins = yield* resolver.discoverFromDirectory(pluginsDir);

      assert.equal(plugins.length, 0);
    }),
  );

  it.effect("rejects legacy top-level nav manifests", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const packageRoot = path.join(
        yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-resolver-legacy-nav-" }),
        "plugin",
      );
      yield* writePluginPackage({
        packageRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [{ id: "main", label: "Test", surface: "app" }],
          nav: [{ id: "main", label: "Test", routeId: "main" }],
          commands: [],
        },
      });

      const result = yield* Effect.flip(loadPluginPackage(packageRoot));
      assert.include(result.message, "legacy top-level nav");
    }),
  );

  it.effect("rejects duplicate route and placement ids", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-plugin-resolver-duplicate-ids-",
      });
      const duplicateRoutesRoot = path.join(root, "duplicate-routes");
      const duplicatePlacementsRoot = path.join(root, "duplicate-placements");

      yield* writePluginPackage({
        packageRoot: duplicateRoutesRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [
            { id: "main", label: "Test", surface: "app" },
            { id: "main", label: "Duplicate", surface: "app" },
          ],
          ui: { placements: [] },
          commands: [],
        },
      });
      const duplicateRouteResult = yield* Effect.flip(loadPluginPackage(duplicateRoutesRoot));
      assert.include(duplicateRouteResult.message, "duplicate route id");

      yield* writePluginPackage({
        packageRoot: duplicatePlacementsRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [{ id: "main", label: "Test", surface: "app" }],
          ui: {
            placements: [
              {
                id: "main-sidebar",
                position: "sidebar.primary",
                label: "Test",
                routeId: "main",
              },
              {
                id: "main-sidebar",
                position: "sidebar.footer",
                label: "Test Footer",
                routeId: "main",
              },
            ],
          },
          commands: [],
        },
      });
      const duplicatePlacementResult = yield* Effect.flip(
        loadPluginPackage(duplicatePlacementsRoot),
      );
      assert.include(duplicatePlacementResult.message, "duplicate placement id");
    }),
  );

  it.effect("rejects placements that reference missing or incompatible routes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-plugin-resolver-placement-routes-",
      });
      const missingRouteRoot = path.join(root, "missing-route");
      const sidebarSettingsRoot = path.join(root, "sidebar-settings");
      const settingsAppRoot = path.join(root, "settings-app");

      yield* writePluginPackage({
        packageRoot: missingRouteRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [{ id: "main", label: "Test", surface: "app" }],
          ui: {
            placements: [
              {
                id: "missing",
                position: "sidebar.primary",
                label: "Missing",
                routeId: "missing",
              },
            ],
          },
          commands: [],
        },
      });
      const missingRouteResult = yield* Effect.flip(loadPluginPackage(missingRouteRoot));
      assert.include(missingRouteResult.message, "references missing route");

      yield* writePluginPackage({
        packageRoot: sidebarSettingsRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [{ id: "settings", label: "Test", surface: "settings" }],
          ui: {
            placements: [
              {
                id: "sidebar",
                position: "sidebar.primary",
                label: "Sidebar",
                routeId: "settings",
              },
            ],
          },
          commands: [],
        },
      });
      const sidebarSettingsResult = yield* Effect.flip(loadPluginPackage(sidebarSettingsRoot));
      assert.include(sidebarSettingsResult.message, "must target an app route");

      yield* writePluginPackage({
        packageRoot: settingsAppRoot,
        manifest: {
          id: "t3.test",
          name: "Test",
          version: "0.0.1",
          routes: [{ id: "main", label: "Test", surface: "app" }],
          ui: {
            placements: [
              {
                id: "settings",
                position: "settings.sidebar",
                label: "Settings",
                routeId: "main",
              },
            ],
          },
          commands: [],
        },
      });
      const settingsAppResult = yield* Effect.flip(loadPluginPackage(settingsAppRoot));
      assert.include(settingsAppResult.message, "must target a settings route");
    }),
  );
});
