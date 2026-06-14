/**
 * `schemaToAffordance` (Epic 25 §askUser decision cards) — derive a SERIALIZABLE descriptor of
 * the input affordance an `askUser` schema implies, so the host can render a decision card.
 * The live schema object never crosses the dispatch/journal boundary (it isn't canonical-JSON);
 * the descriptor is what rides in the `user.input` payload instead.
 *
 * One rich kind ships in this slice: a string-literal union (`Schema.Literals([...])`, or a
 * Struct whose single field is one) becomes `{ kind: "choice", field?, options }`. Anything the
 * walker does not positively recognize falls back to `{ kind: "text" }` — the freeform reply
 * box — so an exotic schema can never break the ask path, it just renders less richly. Future
 * affordance kinds (boolean → approve/reject, multi-field struct → form) plug in here as new
 * descriptor variants plus a recognizer branch.
 */

import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

/** Serializable input-affordance descriptor for an `askUser` decision card. */
export type AskAffordance =
  | {
      readonly kind: "choice";
      /** Present when the schema is a Struct wrapping the literal union in a single field —
       * the chosen option must be submitted as `{ [field]: option }`. */
      readonly field?: string;
      readonly options: ReadonlyArray<string>;
    }
  | { readonly kind: "text" };

/** The string-literal options of `ast`, or `undefined` if it is not a pure string-literal
 * shape (a lone string Literal, or a Union whose every member is a string Literal). */
function literalOptions(ast: SchemaAST.AST): ReadonlyArray<string> | undefined {
  if (SchemaAST.isLiteral(ast)) {
    return typeof ast.literal === "string" ? [ast.literal] : undefined;
  }
  if (!SchemaAST.isUnion(ast)) return undefined;
  const options: string[] = [];
  for (const member of ast.types) {
    if (!SchemaAST.isLiteral(member) || typeof member.literal !== "string") return undefined;
    options.push(member.literal);
  }
  return options.length > 0 ? options : undefined;
}

export function schemaToAffordance(schema: Schema.Schema<unknown> | undefined): AskAffordance {
  if (schema === undefined) return { kind: "text" };
  const ast = schema.ast;
  const direct = literalOptions(ast);
  if (direct !== undefined) return { kind: "choice", options: direct };
  if (
    SchemaAST.isObjects(ast) &&
    ast.propertySignatures.length === 1 &&
    ast.indexSignatures.length === 0
  ) {
    const prop = ast.propertySignatures[0];
    if (prop !== undefined && typeof prop.name === "string") {
      const nested = literalOptions(prop.type);
      if (nested !== undefined) return { kind: "choice", field: prop.name, options: nested };
    }
  }
  return { kind: "text" };
}
