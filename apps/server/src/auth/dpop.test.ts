import { describe, expect, it } from "vite-plus/test";
import * as PlatformError from "effect/PlatformError";

import { SecretStoreError } from "./ServerSecretStore.ts";
import { mapDpopReplayStoreError } from "./dpop.ts";

const storeFailure = (tag: "AlreadyExists" | "PermissionDenied") =>
  new SecretStoreError({
    operation: "persist",
    resource: "DPoP proof",
    cause: PlatformError.systemError({
      _tag: tag,
      module: "FileSystem",
      method: "open",
      pathOrDescriptor: "dpop-proof.bin",
    }),
  });

describe("mapDpopReplayStoreError", () => {
  it("reports replay conflicts as invalid credentials", () => {
    const error = mapDpopReplayStoreError(storeFailure("AlreadyExists"));

    expect(error._tag).toBe("ServerAuthInvalidCredentialError");
  });

  it("reports replay-store availability failures as internal errors", () => {
    const error = mapDpopReplayStoreError(storeFailure("PermissionDenied"));

    expect(error._tag).toBe("ServerAuthOperationError");
    if (error._tag === "ServerAuthOperationError") {
      expect(error.operation).toBe("record_dpop_replay_state");
      expect(error.message).toContain("record_dpop_replay_state");
    }
  });
});
