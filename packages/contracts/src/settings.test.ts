import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  ClientSettingsSchema,
  DEFAULT_TERMINAL_BOTTOM_SCOPE,
  DEFAULT_TERMINAL_POSITION,
  DEFAULT_TERMINAL_RIGHT_RAIL_WIDTH_MODE,
  DEFAULT_UNIFIED_SETTINGS,
} from "./settings";

it.effect("defaults bottom terminal scope to the chat column", () =>
  Effect.gen(function* () {
    const settings = yield* Schema.decodeUnknownEffect(ClientSettingsSchema)({});

    assert.strictEqual(settings.terminalBottomScope, DEFAULT_TERMINAL_BOTTOM_SCOPE);
    assert.strictEqual(settings.terminalPosition, DEFAULT_TERMINAL_POSITION);
    assert.strictEqual(settings.terminalRightRailWidthMode, DEFAULT_TERMINAL_RIGHT_RAIL_WIDTH_MODE);
    assert.strictEqual(DEFAULT_UNIFIED_SETTINGS.terminalBottomScope, DEFAULT_TERMINAL_BOTTOM_SCOPE);
    assert.strictEqual(DEFAULT_UNIFIED_SETTINGS.terminalPosition, DEFAULT_TERMINAL_POSITION);
    assert.strictEqual(
      DEFAULT_UNIFIED_SETTINGS.terminalRightRailWidthMode,
      DEFAULT_TERMINAL_RIGHT_RAIL_WIDTH_MODE,
    );
  }),
);

it.effect("accepts the workspace bottom terminal scope", () =>
  Effect.gen(function* () {
    const settings = yield* Schema.decodeUnknownEffect(ClientSettingsSchema)({
      terminalBottomScope: "workspace",
    });

    assert.strictEqual(settings.terminalBottomScope, "workspace");
  }),
);

it.effect("accepts the right terminal position and independent right rail widths", () =>
  Effect.gen(function* () {
    const settings = yield* Schema.decodeUnknownEffect(ClientSettingsSchema)({
      terminalPosition: "right",
      terminalRightRailWidthMode: "independent",
    });

    assert.strictEqual(settings.terminalPosition, "right");
    assert.strictEqual(settings.terminalRightRailWidthMode, "independent");
  }),
);

it.effect("migrates the removed left terminal position back to bottom", () =>
  Effect.gen(function* () {
    const settings = yield* Schema.decodeUnknownEffect(ClientSettingsSchema)({
      terminalPosition: "left",
    });

    assert.strictEqual(settings.terminalPosition, "bottom");
  }),
);
