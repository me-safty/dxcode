import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
// Static import (not a runtime createRequire) so esbuild BUNDLES json-logic-js
// into the plugin's server bundle — the installed plugin ships no node_modules,
// so a runtime require would fail to load.
import jsonLogic from "json-logic-js";

import {
  PredicateEvaluationError,
  PredicateEvaluator,
  type PredicateEvaluatorShape,
} from "../Services/PredicateEvaluator.ts";
import { inspectJsonLogicRule } from "../jsonLogicRule.ts";
const isPredicateEvaluationError = Schema.is(PredicateEvaluationError);

const makePredicateError = (message: string, cause?: unknown) =>
  new PredicateEvaluationError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const evaluateRule = (rule: unknown, context: unknown) =>
  Effect.try({
    try: () => {
      const inspection = inspectJsonLogicRule(rule);
      const issue = inspection.issues[0];
      if (issue !== undefined) {
        throw makePredicateError(issue.message);
      }
      const raw = jsonLogic.apply(rule, context);
      return {
        result: jsonLogic.truthy(raw),
        matchedPaths: inspection.variablePaths,
      };
    },
    catch: (cause) =>
      isPredicateEvaluationError(cause)
        ? cause
        : makePredicateError("JSONLogic evaluation failed", cause),
  });

const make = Effect.succeed({
  evaluate: evaluateRule,
} satisfies PredicateEvaluatorShape);

export const PredicateEvaluatorLive = Layer.effect(PredicateEvaluator, make);
