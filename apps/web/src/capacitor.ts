interface CapacitorRuntimeGlobal {
  readonly isNativePlatform?: () => boolean;
}

export function isCapacitorNativeApp(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    (
      window as Window & { readonly Capacitor?: CapacitorRuntimeGlobal }
    ).Capacitor?.isNativePlatform?.() === true
  );
}
