export interface SettingsRouteSearch {
  rt?: string;
}

export function isSettingsPathname(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function normalizeSettingsReturnTo(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0 || !trimmedValue.startsWith("/")) {
    return undefined;
  }

  try {
    const url = new URL(trimmedValue, "https://t3code.local");
    const normalizedPath = `${url.pathname}${url.search}${url.hash}`;
    if (isSettingsPathname(url.pathname)) {
      return undefined;
    }

    return normalizedPath;
  } catch {
    return undefined;
  }
}

export function parseSettingsRouteSearch(search: Record<string, unknown>): SettingsRouteSearch {
  const rt = normalizeSettingsReturnTo(search.rt);
  return rt ? { rt } : {};
}

export function getCurrentSettingsReturnTo() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return normalizeSettingsReturnTo(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}
