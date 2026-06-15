import type { EnvironmentId } from "@t3tools/contracts";
import { File } from "@pierre/diffs/react";
import { ChevronRight, FolderTree, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import FileBrowserPanel from "./FileBrowserPanel";
import { fileBreadcrumbs } from "./filePath";
import { useProjectFileQuery } from "./projectFilesQueryState";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  relativePath: string;
  onOpenFile: (relativePath: string) => void;
}

const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";

function initialExplorerOpen(): boolean {
  try {
    return window.localStorage.getItem(FILE_EXPLORER_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export default function FilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  relativePath,
  onOpenFile,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const file = useProjectFileQuery(environmentId, cwd, relativePath);
  const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
  const breadcrumbs = useMemo(
    () => fileBreadcrumbs(projectName, relativePath),
    [projectName, relativePath],
  );

  const toggleExplorer = () => {
    setExplorerOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(FILE_EXPLORER_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-y border-border/60 px-3">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-xs">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path || "project"} className="flex shrink-0 items-center">
              {index > 0 ? (
                <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
              ) : null}
              <span
                className={cn(
                  "max-w-40 truncate",
                  crumb.kind === "file" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                title={crumb.path || projectName}
              >
                {crumb.label}
              </span>
            </div>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  explorerOpen && "bg-accent text-foreground",
                )}
                aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
                aria-pressed={explorerOpen}
                onClick={toggleExplorer}
              >
                <FolderTree className="size-4" />
              </button>
            }
          />
          <TooltipPopup>{explorerOpen ? "Hide file explorer" : "Show file explorer"}</TooltipPopup>
        </Tooltip>
      </div>
      {file.data?.truncated ? (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {file.error && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
              {file.error}
            </div>
          ) : file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : (
            <File
              key={`${relativePath}:${resolvedTheme}:${file.data.byteLength}`}
              disableWorkerPool
              file={{
                name: relativePath,
                contents: file.data.contents,
                cacheKey: `${cwd}:${relativePath}:${file.data.byteLength}`,
              }}
              options={{
                disableFileHeader: true,
                overflow: "scroll",
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme,
              }}
              className="min-h-0 flex-1 overflow-auto"
            />
          )}
        </div>
        {explorerOpen ? (
          <aside className="flex min-h-0 w-[min(22rem,46%)] min-w-64 shrink-0 border-l border-border/60 bg-background">
            <FileBrowserPanel
              environmentId={environmentId}
              cwd={cwd}
              projectName={projectName}
              onOpenFile={onOpenFile}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
