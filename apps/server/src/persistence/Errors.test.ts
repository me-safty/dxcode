import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

const decodeString = Schema.decodeUnknownEffect(Schema.String);

it("keeps SQL operation context without a tautological detail", () => {
  const cause = new Error("database unavailable");
  const error = new PersistenceSqlError({
    operation: "AuthSessionRepository.list:query",
    cause,
  });

  assert.equal(error.operation, "AuthSessionRepository.list:query");
  assert.equal(error.detail, undefined);
  assert.equal(error.cause, cause);
  assert.equal(error.message, "SQL error in AuthSessionRepository.list:query");
});

it.effect("maps schema errors with their formatted issue and exact cause", () =>
  Effect.gen(function* () {
    const cause = yield* Effect.flip(decodeString(42));
    const error = PersistenceDecodeError.fromSchemaError(
      "ProviderSessionRuntimeRepository.list:decodeRows",
      cause,
    );

    assert.equal(error.operation, "ProviderSessionRuntimeRepository.list:decodeRows");
    assert.equal(error.cause, cause);
    assert.include(error.issue, "Expected string");
  }),
);
