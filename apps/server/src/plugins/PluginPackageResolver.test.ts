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
});
