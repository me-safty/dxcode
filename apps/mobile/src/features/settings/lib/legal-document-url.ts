export function resolveLegalDocumentUrl(defaultUrl: string, override: string | undefined): string {
  const candidate = override?.trim();
  if (!candidate) return defaultUrl;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : defaultUrl;
  } catch {
    return defaultUrl;
  }
}
