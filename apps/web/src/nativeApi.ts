import type { NativeApi } from "@t3tools/contracts";

import { createWsNativeApi } from "./wsNativeApi";

type NativeApiGlobal = typeof globalThis & {
  __t3NativeApi?: NativeApi;
};

const readCachedNativeApi = () => (globalThis as NativeApiGlobal).__t3NativeApi;

const writeCachedNativeApi = (api: NativeApi) => {
  (globalThis as NativeApiGlobal).__t3NativeApi = api;
};

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  const cachedApi = readCachedNativeApi();
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    writeCachedNativeApi(window.nativeApi);
    return window.nativeApi;
  }

  const nextApi = createWsNativeApi();
  writeCachedNativeApi(nextApi);
  return nextApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}
