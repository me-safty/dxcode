import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "./runtime";

export function probeCodexAccountUsage(input: {
  readonly shadowHomePath: string;
  readonly binaryPath: string;
}) {
  return runPrimaryHttp(
    Effect.gen(function* () {
      const client = yield* PrimaryEnvironmentHttpClient;
      return yield* client.provider.probeCodexUsage({
        payload: {
          shadowHomePath: input.shadowHomePath,
          binaryPath: input.binaryPath,
        },
        headers: {},
      });
    }),
  );
}

export function loginCodexAccount(input: {
  readonly shadowHomePath: string;
  readonly binaryPath: string;
}) {
  return runPrimaryHttp(
    Effect.gen(function* () {
      const client = yield* PrimaryEnvironmentHttpClient;
      return yield* client.provider.loginCodexAccount({
        payload: {
          shadowHomePath: input.shadowHomePath,
          binaryPath: input.binaryPath,
        },
        headers: {},
      });
    }),
  );
}

export function scanCodexProfiles(input: { readonly basePath: string }) {
  return runPrimaryHttp(
    Effect.gen(function* () {
      const client = yield* PrimaryEnvironmentHttpClient;
      return yield* client.provider.scanCodexProfiles({
        payload: {
          basePath: input.basePath,
        },
        headers: {},
      });
    }),
  );
}
