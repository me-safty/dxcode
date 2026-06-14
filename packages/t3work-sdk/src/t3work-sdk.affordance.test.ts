/**
 * `schemaToAffordance` (Epic 25 §askUser decision cards) — the recognizer must positively
 * identify the one rich shape this slice ships (string-literal unions, bare or wrapped in a
 * single-field Struct) and fall back to `{ kind: "text" }` for everything else, so an exotic
 * schema renders the freeform reply box instead of breaking the ask.
 */

import { describe, expect, it } from "vite-plus/test";

import * as Schema from "effect/Schema";

import { schemaToAffordance } from "./t3work-sdk.affordance.ts";

describe("schemaToAffordance", () => {
  it("maps a string-literal union to a choice", () => {
    expect(schemaToAffordance(Schema.Literals(["ship-now", "hold", "rollback"]))).toEqual({
      kind: "choice",
      options: ["ship-now", "hold", "rollback"],
    });
  });

  it("maps a lone string literal to a single-option choice", () => {
    expect(schemaToAffordance(Schema.Literal("acknowledge"))).toEqual({
      kind: "choice",
      options: ["acknowledge"],
    });
  });

  it("maps a Struct whose single field is a literal union to a fielded choice", () => {
    const schema = Schema.Struct({ severity: Schema.Literals(["low", "high"]) });
    expect(schemaToAffordance(schema as Schema.Schema<unknown>)).toEqual({
      kind: "choice",
      field: "severity",
      options: ["low", "high"],
    });
  });

  it("falls back to text when no schema is given", () => {
    expect(schemaToAffordance(undefined)).toEqual({ kind: "text" });
  });

  it("falls back to text for a plain string schema", () => {
    expect(schemaToAffordance(Schema.String)).toEqual({ kind: "text" });
  });

  it("falls back to text for non-string literal members", () => {
    expect(schemaToAffordance(Schema.Literals([1, 2, 3]))).toEqual({ kind: "text" });
    expect(schemaToAffordance(Schema.Literals(["yes", 1]))).toEqual({ kind: "text" });
  });

  it("falls back to text for a multi-field Struct", () => {
    const schema = Schema.Struct({
      severity: Schema.Literals(["low", "high"]),
      note: Schema.String,
    });
    expect(schemaToAffordance(schema as Schema.Schema<unknown>)).toEqual({ kind: "text" });
  });

  it("falls back to text for a single-field Struct whose field is not a literal union", () => {
    const schema = Schema.Struct({ answer: Schema.String });
    expect(schemaToAffordance(schema as Schema.Schema<unknown>)).toEqual({ kind: "text" });
  });

  it("falls back to text for a union with non-literal members", () => {
    const schema = Schema.Union([Schema.Literal("a"), Schema.String]);
    expect(schemaToAffordance(schema as Schema.Schema<unknown>)).toEqual({ kind: "text" });
  });
});
