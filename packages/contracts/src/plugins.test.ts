import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PluginManifest } from "./plugins.ts";

const decodePluginManifest = Schema.decodeUnknownEffect(PluginManifest);

it.effect("PluginManifest validates stable plugin ids, routes, nav, and commands", () =>
  Effect.gen(function* () {
    const manifest = yield* decodePluginManifest({
      id: "t3.automations",
      name: "Automations",
      version: "0.1.0",
      routes: [{ id: "main", label: "Automations" }],
      nav: [{ id: "main", label: "Automations", routeId: "main", badgeCount: 1 }],
      commands: [{ name: "automations.rules.list", label: "List rules" }],
    });

    assert.equal(manifest.id, "t3.automations");
    assert.equal(manifest.nav[0]?.badgeCount, 1);

    const invalid = yield* Effect.flip(
      decodePluginManifest({
        id: "not allowed",
        name: "Broken",
        version: "0.1.0",
        routes: [],
        nav: [],
        commands: [],
      }),
    );
    assert.include(String(invalid), "not allowed");
  }),
);
