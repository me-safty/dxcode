import type {
  SandboxProvider,
  SandboxProviderRegistry as BaseSandboxProviderRegistry,
} from "@t3tools/sandbox";
import type { SandboxProviderKind } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { SandboxError } from "@t3tools/sandbox";

export interface SandboxProviderRegistryShape {
  readonly get: (providerKind: SandboxProviderKind) => Effect.Effect<SandboxProvider, SandboxError>;
}

export class SandboxProviderRegistry extends Context.Service<
  SandboxProviderRegistry,
  SandboxProviderRegistryShape
>()("t3/sandbox/Services/SandboxProviderRegistry") {}

export function fromBaseSandboxProviderRegistry(
  registry: BaseSandboxProviderRegistry,
): SandboxProviderRegistryShape {
  return {
    get: registry.get,
  };
}
