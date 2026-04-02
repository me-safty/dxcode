import type { NativeApi } from "@t3tools/contracts";

import { createWsNativeApi } from "./wsNativeApi";

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.nativeApi) {
    return window.nativeApi;
  }

  return createWsNativeApi();
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}
