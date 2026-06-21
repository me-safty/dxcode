import { assert, it } from "@effect/vitest";

import {
  sourceControlProviderError,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it("normalizes control characters and bounds error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(`  owner/repo\n\t${"x".repeat(300)}  `),
    `owner/repo ${"x".repeat(245)}`,
  );
});

it("wraps provider command errors with safe transport context and the original cause", () => {
  const cause = {
    command: "gh",
    detail: "Pull request not found.",
  };
  const error = sourceControlProviderError({
    provider: "github",
    operation: "getChangeRequest",
    cwd: "/repo",
    reference: "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    repository: "owner/repo\nbranch",
    error: cause,
  });

  assert.strictEqual(error.provider, "github");
  assert.strictEqual(error.operation, "getChangeRequest");
  assert.strictEqual(error.command, "gh");
  assert.strictEqual(error.cwd, "/repo");
  assert.strictEqual(error.reference, "https://example.test/org/repo/pull/42");
  assert.strictEqual(error.repository, "owner/repo branch");
  assert.strictEqual(error.detail, "Pull request not found.");
  assert.strictEqual(error.cause, cause);
});
