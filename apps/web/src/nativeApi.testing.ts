import type { NativeApi } from "@t3tools/contracts";

import type { WsRpcClient } from "./wsRpcClient";

type NativeApiTestGlobal = typeof globalThis & {
  __t3NativeApi?: NativeApi;
  __t3WsRpcClient?: WsRpcClient | null;
};

export function resetNativeApiForTests() {
  delete (globalThis as NativeApiTestGlobal).__t3NativeApi;
  delete (globalThis as NativeApiTestGlobal).__t3WsRpcClient;

  if (typeof window !== "undefined") {
    delete window.nativeApi;
  }
}
