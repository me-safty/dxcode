import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

// Mosaic introspection tools, surfaced to the agent over T3 Code's MCP host so
// it can learn a block's exact schema (and validate a draft) before emitting a
// ```mosaic artifact - instead of guessing prop shapes. The tool logic lives in
// @mosaicjs/ai; these are the read-only, side-effect-free MCP wrappers.

const introspectionTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true) as T;

export const MosaicLsTool = introspectionTool(
  Tool.make("mosaic_ls", {
    description:
      "List every Mosaic block you can compose a ```mosaic artifact from, grouped by kind. Call this first when building a Mosaic artifact to see what is available. Pass kind to narrow to one group.",
    parameters: Schema.Struct({
      kind: Schema.optional(
        Schema.String.annotate({
          description: "Optional: one of layout, content, control, structure, data.",
        }),
      ),
    }),
    success: Schema.String,
  }).annotate(Tool.Title, "List Mosaic blocks"),
);

export const MosaicCatTool = introspectionTool(
  Tool.make("mosaic_cat", {
    description:
      "Show one Mosaic block's full prop schema - prop names, types, enum values, nested shapes, which are required - plus a minimal example. Call before using a block you are unsure about (DataTable, Chart, Diagram, Timeline, Tabs) so you write the exact schema instead of guessing.",
    parameters: Schema.Struct({
      block: Schema.String.annotate({ description: 'The block name, e.g. "DataTable".' }),
    }),
    success: Schema.String,
  }).annotate(Tool.Title, "Show a Mosaic block schema"),
);

export const MosaicValidateTool = introspectionTool(
  Tool.make("mosaic_validate", {
    description:
      "Compile and validate a Mosaic artifact (the mosaic-jsx inside a ```mosaic fence, or the bare source) and return every error, or confirm it is sound. Run this on your draft before emitting so mistakes are caught and fixed first.",
    parameters: Schema.Struct({
      source: Schema.String.annotate({ description: "The mosaic-jsx source to validate." }),
    }),
    success: Schema.String,
  }).annotate(Tool.Title, "Validate a Mosaic artifact"),
);

export const MosaicToolkit = Toolkit.make(MosaicLsTool, MosaicCatTool, MosaicValidateTool);
