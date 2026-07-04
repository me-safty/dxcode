import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectScriptTrust } from "../Services/ProjectScriptTrust.ts";
import { TestSql } from "../testHarness.ts";
import { ProjectScriptTrustLive } from "./ProjectScriptTrust.ts";

const layer = it.layer(ProjectScriptTrustLive.pipe(Layer.provideMerge(TestSql)));

layer("ProjectScriptTrustLive", (it) => {
  it.effect("persists per-project trust grants and revocations", () =>
    Effect.gen(function* () {
      const trust = yield* ProjectScriptTrust;
      const projectId = ProjectId.make("project-trust");

      assert.isFalse(yield* trust.isTrusted(projectId));

      yield* trust.setTrusted(projectId, true);
      assert.isTrue(yield* trust.isTrusted(projectId));

      yield* trust.setTrusted(projectId, false);
      assert.isFalse(yield* trust.isTrusted(projectId));
    }),
  );
});
