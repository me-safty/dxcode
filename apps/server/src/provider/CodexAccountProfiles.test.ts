import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { resolveCodexProfileHomePath, scanCodexProfileHomes } from "./CodexAccountProfiles.ts";

const makeTempDir = Effect.fn("CodexAccountProfiles.test.makeTempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

it.layer(NodeServices.layer)("CodexAccountProfiles", (it) => {
  it.effect("finds nested Codex Desktop homes and direct CODEX_HOME profiles", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const basePath = yield* makeTempDir("t3code-codex-accounts-");
      const nestedHome = path.join(basePath, "account-2", "codex-home");
      const directHome = path.join(basePath, "account-10");
      yield* fileSystem.makeDirectory(nestedHome, { recursive: true });
      yield* fileSystem.makeDirectory(directHome, { recursive: true });
      yield* fileSystem.makeDirectory(path.join(basePath, "not-an-account"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(nestedHome, "auth.json"), "{}");
      yield* fileSystem.writeFileString(path.join(directHome, "auth.json"), "{}");

      expect(yield* resolveCodexProfileHomePath(path.join(basePath, "account-2"))).toBe(nestedHome);
      expect(yield* scanCodexProfileHomes(basePath)).toEqual([nestedHome, directHome]);
    }),
  );
});
