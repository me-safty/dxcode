import type { SandboxProviderKind, SandboxServiceDescriptor } from "@t3tools/contracts";

export function extractT3RuntimeEndpoint(
  services: ReadonlyArray<SandboxServiceDescriptor> | undefined,
): string | undefined {
  const runtimeService = services?.find((service) => service.kind === "t3-runtime");
  const typedEndpoint = runtimeService?.endpoints?.find(
    (endpoint) =>
      (endpoint.protocol === "http" || endpoint.protocol === "https") &&
      (endpoint.accessMode === "server" || endpoint.accessMode === "private"),
  );
  return typedEndpoint?.url ?? runtimeService?.endpointUrl;
}

export function resolveTaskRuntimeBridgeBaseUrl(args: {
  readonly providerKind: SandboxProviderKind | undefined;
  readonly runtimeEndpointUrl: string | undefined;
}): string | undefined {
  if (args.runtimeEndpointUrl !== undefined && args.runtimeEndpointUrl.trim() !== "") {
    return args.runtimeEndpointUrl;
  }
  if (args.providerKind === undefined || args.providerKind === "local") {
    return undefined;
  }
  throw new Error(`Missing runtime endpoint for ${args.providerKind} task sandbox`);
}
