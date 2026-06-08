import { useEffect } from "react";

// The app's own favicon, declared statically in index.html. We restore this
// whenever no project-specific icon applies (home, settings, pairing).
const DEFAULT_FAVICON_HREF = "/favicon.ico";
const MANAGED_FAVICON_ID = "app-dynamic-favicon";

function ensureManagedFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const existing = document.getElementById(MANAGED_FAVICON_ID);
  if (existing instanceof HTMLLinkElement) {
    return existing;
  }

  const link = document.createElement("link");
  link.id = MANAGED_FAVICON_ID;
  link.rel = "icon";
  // Appended last so it wins over the static <link rel="icon"> declarations.
  document.head.appendChild(link);
  return link;
}

function applyFaviconHref(href: string): void {
  const link = ensureManagedFaviconLink();
  if (link && link.href !== href) {
    link.href = href;
  }
}

// Swaps the browser tab favicon to the given URL, falling back to the app icon
// when `url` is null. The candidate is preloaded first so a failed request
// (offline, unreachable environment) leaves the existing icon untouched rather
// than flashing a broken image.
export function useDocumentFavicon(url: string | null | undefined): void {
  useEffect(() => {
    if (!url) {
      applyFaviconHref(DEFAULT_FAVICON_HREF);
      return;
    }

    let cancelled = false;
    const probe = new Image();
    probe.addEventListener(
      "load",
      () => {
        if (!cancelled) {
          applyFaviconHref(url);
        }
      },
      { once: true },
    );
    probe.addEventListener(
      "error",
      () => {
        if (!cancelled) {
          applyFaviconHref(DEFAULT_FAVICON_HREF);
        }
      },
      { once: true },
    );
    probe.src = url;

    return () => {
      cancelled = true;
      applyFaviconHref(DEFAULT_FAVICON_HREF);
    };
  }, [url]);
}
