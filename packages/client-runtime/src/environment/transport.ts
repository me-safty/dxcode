import type {
  ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentRpcTransport,
} from "@t3tools/contracts";

export function selectRpcTransport(
  descriptor: ExecutionEnvironmentDescriptor,
  options?: { readonly hasCompressionCodec?: boolean },
): ExecutionEnvironmentRpcTransport {
  // Only prefer the compressed transport when this platform actually provides
  // a codec; otherwise a codec-less client would connect to the gzip endpoint
  // and speak plain JSON at it.
  const preferred =
    options?.hasCompressionCodec === true
      ? descriptor.rpcTransports?.find((transport) => transport.kind === "gzip-json")
      : undefined;
  return (
    preferred ??
    descriptor.rpcTransports?.find((transport) => transport.kind === "json") ?? {
      kind: "json",
      path: "/ws",
    }
  );
}

export function selectThreadSyncVersion(descriptor: ExecutionEnvironmentDescriptor): 1 | 2 {
  return descriptor.threadSyncVersions?.includes(2) ? 2 : 1;
}

export function applyRpcTransport(
  socketUrl: string,
  transport: ExecutionEnvironmentRpcTransport,
): string {
  const url = new URL(socketUrl);
  const path = transport.path.startsWith("/") ? transport.path : `/${transport.path}`;
  // Replace only the trailing RPC segment so a reverse-proxied base path
  // (e.g. wss://host/prefix/ws) keeps its prefix instead of being overwritten.
  url.pathname = url.pathname.replace(/\/ws(-compressed)?\/?$/, "") + path;
  return url.toString();
}
