import { File, Virtualizer, type FileContents } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, PanelRightCloseIcon, TextWrapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  CODE_HIGHLIGHT_TOKENIZE_MAX_LINE_LENGTH,
  createCodeHighlightCacheKey,
  FILE_PREVIEW_HIGHLIGHT_MAX_BYTES,
  resolveCodeHighlightLanguageFromPath,
} from "../codeHighlighting";
import { readEnvironmentApi } from "../environmentApi";
import { formatWorkspaceRelativePath } from "../filePathDisplay";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName } from "../lib/diffRendering";
import type { WorkspaceFilePreviewTarget } from "../workspaceFilePreview";
import { closeWorkspaceFilePreview } from "../workspaceFilePreview";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Button } from "./ui/button";

const FILE_PREVIEW_LINE_HEIGHT = 20;
const FILE_PREVIEW_VIRTUALIZER_CLASS_NAME = "workspace-file-preview-virtualizer";

const FILE_PREVIEW_RENDER_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": `${FILE_PREVIEW_LINE_HEIGHT}px`,
  "--diffs-font-family":
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as CSSProperties;

const FILE_PREVIEW_UNSAFE_CSS = `
[data-file],
[data-virtualizer-buffer] {
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: var(--background);
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-buffer-override: var(--background);
  background-color: var(--background) !important;
}

[data-file] {
  --diffs-grid-number-column-width: 3.5rem;
  color: color-mix(in srgb, var(--foreground) 85%, transparent);
}

[data-column-number] {
  padding-right: 0.75rem !important;
  color: color-mix(in srgb, var(--muted-foreground) 45%, transparent) !important;
  user-select: none;
}

[data-line],
[data-column-number],
[data-gutter-buffer] {
  min-height: ${FILE_PREVIEW_LINE_HEIGHT}px;
}

[data-line][data-selected-line],
[data-column-number][data-selected-line] {
  --diffs-line-bg: color-mix(in srgb, var(--background) 88%, var(--primary)) !important;
}
`;

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePreviewContents(contents: string): string {
  return contents.replace(/\r\n/g, "\n");
}

function workspaceFilePreviewQueryOptions(target: WorkspaceFilePreviewTarget | null) {
  return {
    queryKey: [
      "workspaceFilePreview",
      target?.environmentId ?? null,
      target?.cwd ?? null,
      target?.relativePath ?? null,
    ],
    enabled: target !== null,
    queryFn: async () => {
      if (!target) {
        throw new Error("No file selected.");
      }
      const api = readEnvironmentApi(target.environmentId);
      if (!api) {
        throw new Error("Environment API not found.");
      }
      return api.projects.readFile({
        cwd: target.cwd,
        relativePath: target.relativePath,
      });
    },
  };
}

function getFilePreviewScrollElement(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`.${FILE_PREVIEW_VIRTUALIZER_CLASS_NAME}`) ?? null;
}

export function WorkspaceFilePreviewPanel(props: {
  mode: DiffPanelMode;
  target: WorkspaceFilePreviewTarget | null;
}) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [wordWrap, setWordWrap] = useState(true);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollKeyRef = useRef<string | null>(null);
  const query = useQuery(workspaceFilePreviewQueryOptions(props.target));
  const fileContents = query.data?.contents ?? "";
  const previewContents = useMemo(() => normalizePreviewContents(fileContents), [fileContents]);
  const highlightLanguage = useMemo(
    () => (props.target ? resolveCodeHighlightLanguageFromPath(props.target.relativePath) : "text"),
    [props.target],
  );
  const highlightEnabled =
    query.data !== undefined && query.data.sizeBytes <= FILE_PREVIEW_HIGHLIGHT_MAX_BYTES;
  const renderLanguage = highlightEnabled ? highlightLanguage : "text";
  const previewFile = useMemo<FileContents | null>(
    () =>
      query.data
        ? {
            name: query.data.relativePath,
            contents: previewContents,
            lang: renderLanguage,
            cacheKey: createCodeHighlightCacheKey(
              previewContents,
              renderLanguage,
              diffThemeName,
              "file-preview",
            ),
          }
        : null,
    [diffThemeName, previewContents, query.data, renderLanguage],
  );
  const selectedLines = useMemo<{ start: number; end: number } | null>(
    () => (props.target?.line ? { start: props.target.line, end: props.target.line } : null),
    [props.target?.line],
  );
  const targetLine = props.target?.line ?? null;
  const displayPath = props.target
    ? formatWorkspaceRelativePath(props.target.relativePath, props.target.cwd)
    : "No file selected";
  const title = props.target ? basenameOfPath(props.target.relativePath) : "File preview";
  const subtitle = props.target?.displayPath ?? displayPath;

  useEffect(() => {
    if (!targetLine || !props.target || !query.data) {
      return;
    }
    const autoScrollKey = [
      props.target.environmentId,
      props.target.cwd,
      query.data.relativePath,
      targetLine,
      query.data.sizeBytes,
      previewContents.length,
    ].join(":");
    if (lastAutoScrollKeyRef.current === autoScrollKey) {
      return;
    }
    lastAutoScrollKeyRef.current = autoScrollKey;

    const scrollElement = getFilePreviewScrollElement(scrollRootRef.current);
    if (!scrollElement) {
      return;
    }

    scrollElement.scrollTop = Math.max(0, (targetLine - 1) * FILE_PREVIEW_LINE_HEIGHT);

    let secondFrameId: number | null = null;
    const firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        const element = scrollElement.querySelector<HTMLElement>(`[data-line="${targetLine}"]`);
        element?.scrollIntoView({ block: "center" });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [previewContents.length, props.target, query.data, targetLine]);

  const copyFile = useCallback(() => {
    if (!query.data) return;
    copyToClipboard(query.data.contents);
  }, [copyToClipboard, query.data]);

  const header = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {props.target ? (
          <VscodeEntryIcon
            pathValue={props.target.relativePath}
            kind="file"
            theme={resolvedTheme}
            className="size-4 shrink-0 text-muted-foreground/80"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground/70">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          onClick={() => setWordWrap((value) => !value)}
        >
          <TextWrapIcon className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!query.data}
          aria-label={isCopied ? "Copied file" : "Copy file"}
          title={isCopied ? "Copied" : "Copy file"}
          onClick={copyFile}
        >
          {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close file preview"
          title="Close file preview"
          onClick={closeWorkspaceFilePreview}
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={props.mode} header={header}>
      {query.isLoading ? (
        <DiffPanelLoadingState label="Loading file preview..." />
      ) : query.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load file."}
        </div>
      ) : query.data ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {query.data.truncated ? (
            <div className="border-b border-border/60 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              Preview truncated. File size: {formatBytes(query.data.sizeBytes)}.
            </div>
          ) : null}
          <div ref={scrollRootRef} className="min-h-0 flex-1 bg-background">
            {previewFile ? (
              <Virtualizer
                className={`${FILE_PREVIEW_VIRTUALIZER_CLASS_NAME} h-full min-h-0 overflow-auto`}
                contentClassName="min-w-full py-2"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                <File
                  className="workspace-file-preview-render min-w-full"
                  file={previewFile}
                  selectedLines={selectedLines}
                  style={FILE_PREVIEW_RENDER_STYLE}
                  options={{
                    disableFileHeader: true,
                    overflow: wordWrap ? "wrap" : "scroll",
                    theme: diffThemeName,
                    themeType: resolvedTheme,
                    tokenizeMaxLineLength: CODE_HIGHLIGHT_TOKENIZE_MAX_LINE_LENGTH,
                    unsafeCSS: FILE_PREVIEW_UNSAFE_CSS,
                  }}
                />
              </Virtualizer>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          No file selected.
        </div>
      )}
    </DiffPanelShell>
  );
}
