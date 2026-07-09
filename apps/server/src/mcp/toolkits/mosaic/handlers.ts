import { catBlock, lsBlocks, validateSource } from "@mosaicjs/ai";
import * as Effect from "effect/Effect";

import { MosaicToolkit } from "./tools.ts";

// The Mosaic introspection handlers are pure functions over @mosaicjs/core, so
// each tool just wraps a synchronous result in Effect.succeed - no dependencies,
// no capability gate, no I/O.
export const MosaicToolkitHandlersLive = MosaicToolkit.toLayer({
  mosaic_ls: (input) => Effect.succeed(lsBlocks(input.kind)),
  mosaic_cat: (input) => Effect.succeed(catBlock(input.block)),
  mosaic_validate: (input) => Effect.succeed(validateSource(input.source)),
});
