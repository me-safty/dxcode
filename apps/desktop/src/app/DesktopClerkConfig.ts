import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";

declare const __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

export function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    return clerkFrontendApiHostnameFromPublishableKey(normalizedKey);
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
