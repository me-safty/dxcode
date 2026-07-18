import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { deriveServerPaths } from "./config.ts";

it.effect("derives flavor-owned server state beneath the shared base directory", () =>
  Effect.gen(function* () {
    const paths = yield* deriveServerPaths("/tmp/t3", undefined, "dx", true);

    assert.equal(paths.stateDir, "/tmp/t3/dx");
    assert.equal(paths.dbPath, "/tmp/t3/dx/state.sqlite");
    assert.equal(paths.secretsDir, "/tmp/t3/dx/secrets");
    assert.equal(paths.providerStatusCacheDir, "/tmp/t3/dx/caches");
    assert.equal(paths.worktreesDir, "/tmp/t3/dx/worktrees");
  }).pipe(Effect.provide(NodeServices.layer)),
);
