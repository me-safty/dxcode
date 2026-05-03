import { makeSandboxProviderRegistry } from "@t3tools/sandbox";
import { Effect, Layer } from "effect";

import {
  fromBaseSandboxProviderRegistry,
  SandboxProviderRegistry,
} from "../Services/SandboxProviderRegistry.ts";
import { makeLocalSandboxProvider } from "./LocalSandboxProvider.ts";
import { makeModalSandboxProvider } from "./ModalSandboxProvider.ts";

export const SandboxProviderRegistryLive = Layer.effect(
  SandboxProviderRegistry,
  Effect.gen(function* () {
    const localProvider = yield* makeLocalSandboxProvider;
    const modalProvider = makeModalSandboxProvider();
    return fromBaseSandboxProviderRegistry(
      makeSandboxProviderRegistry([localProvider, modalProvider]),
    );
  }),
);
