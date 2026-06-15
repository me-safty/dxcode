import type { EnvironmentId } from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAssetUrl } from "../assets/assetUrls";

const loadedProjectFaviconSrcs = new Set<string>();
const PROJECT_FAVICON_CACHE_VERSION = "2";

// Single source of truth for the per-project favicon URL, shared by the sidebar
// icon and the document (browser tab) favicon so both resolve identically.
export function resolveProjectFaviconUrl(input: {
  environmentId: EnvironmentId;
  cwd: string;
}): string | null {
  try {
    return resolveEnvironmentHttpUrl({
      environmentId: input.environmentId,
      pathname: "/api/project-favicon",
      searchParams: {
        cwd: input.cwd,
        v: PROJECT_FAVICON_CACHE_VERSION,
      },
    });
  } catch {
    return null;
  }
}

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  className?: string;
  isActive?: boolean;
}) {
  const src = useAssetUrl(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
  });
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );
  useEffect(() => {
    setStatus(src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading");
  }, [src]);

  if (!src) {
    return (
      <FolderIcon
        className={`size-3.5 shrink-0 text-muted-foreground/50 ${input.className ?? ""}`}
      />
    );
  }

  return (
    <>
      {status !== "loaded" ? (
        <FolderIcon
          className={`size-3.5 shrink-0 text-muted-foreground/50 ${input.className ?? ""}`}
        />
      ) : null}
      <img
        src={src}
        alt=""
        className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loaded" ? "" : "hidden"} ${input.className ?? ""}`}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
