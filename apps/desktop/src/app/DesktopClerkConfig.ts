declare const __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

export function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    const encodedFrontendApi = normalizedKey.split("_").slice(2).join("_");
    const frontendApi = globalThis.atob(encodedFrontendApi).replace(/\$$/u, "");
    if (frontendApi.length === 0 || frontendApi.includes("/")) return undefined;

    return new URL(`https://${frontendApi}`).hostname;
  } catch {
    return undefined;
  }
}

const desktopClerkFrontendApiHostname = resolveDesktopClerkFrontendApiHostname(
  typeof __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? undefined
    : __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__,
);

export function getDesktopClerkFrontendApiHostname(): string | undefined {
  return desktopClerkFrontendApiHostname;
}

export function isDesktopClerkBridgeEnabled(): boolean {
  return Boolean(desktopClerkFrontendApiHostname);
}
