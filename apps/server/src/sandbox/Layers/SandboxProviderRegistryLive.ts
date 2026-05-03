import { makeSandboxProviderRegistry } from "@t3tools/sandbox";
import { Effect, Layer } from "effect";

import {
  fromBaseSandboxProviderRegistry,
  SandboxProviderRegistry,
} from "../Services/SandboxProviderRegistry.ts";
import { makeLocalSandboxProvider } from "./LocalSandboxProvider.ts";

export const SandboxProviderRegistryLive = Layer.effect(
  SandboxProviderRegistry,
  Effect.gen(function* () {
    const localProvider = yield* makeLocalSandboxProvider;
    return fromBaseSandboxProviderRegistry(makeSandboxProviderRegistry([localProvider]));
  }),
);
