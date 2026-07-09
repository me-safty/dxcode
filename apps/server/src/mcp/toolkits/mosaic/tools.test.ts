import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { MosaicToolkit } from "./tools.ts";

// A provider (Anthropic/OpenAI) rejects an MCP tool whose parameters are not a
// top-level `{ type: "object" }` schema - which is exactly what an empty
// Schema.Struct({}) produced for mosaic_ls. Pin that every Mosaic tool exports a
// provider-compatible object schema so the tools actually load into the model.
it("exports provider-compatible object schemas for every Mosaic tool", () => {
  const tools = Object.values(MosaicToolkit.tools);
  expect(tools.length).toBe(3);
  for (const tool of tools) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    expect(
      schema.properties,
      `${tool.name} must expose a properties object`,
    ).toBeTypeOf("object");
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should carry a useful description`,
    ).toBeGreaterThan(40);
  }
});
