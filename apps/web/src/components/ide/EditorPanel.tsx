import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { EyeIcon, FileWarningIcon, Loader2Icon, PenLineIcon, XIcon } from "lucide-react";

import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import {
  isMarkdownPath,
  isTabDirty,
  selectActiveTab,
  useIdeStore,
  type IdeTab,
} from "../../ideStore";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FileTree } from "./FileTree";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { MarkdownEditor } from "./MarkdownEditor";
import { EditorQuickOpen } from "./EditorQuickOpen";

import "./ide.css";

const TREE_MIN_WIDTH = 140;
const TREE_MAX_WIDTH = 420;

export interface EditorMentionRef {
  relativePath: string;
  fromLine: number;
  toLine: number;
  text: string;
}

interface EditorPanelProps {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Absolute workspace root of the project. */
  cwd: string;
  projectName: string;
  /** "sidebar" = chat right panel chrome, "page" = full project route. */
  variant: "sidebar" | "page";
  /** Shown as a close (X) control in the header when provided. */
  onClose?: () => void;
  /** When set, selecting text shows a "Chat" action that calls this. */
  onMention?: (ref: EditorMentionRef) => void;
  /** Relative path of a file to open once the project loads (e.g. a pin). */
  openFilePath?: string | undefined;
  /** Relative path of a directory to reveal/expand once the project loads. */
  revealPath?: string | undefined;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * The editor surface — a file tree plus a tabbed code/markdown editor for a
 * single project. Shared between the in-chat right panel and the standalone
 * project editor route, styled to match the rest of the app's panels.
 */
export function EditorPanel(props: EditorPanelProps) {
  const { environmentId, projectId, cwd, projectName, variant, onClose, onMention } = props;
  const { openFilePath, revealPath } = props;

  const openProject = useIdeStore((state) => state.openProject);
  const tabs = useIdeStore(useShallow((state) => state.tabs));
  const activeTab = useIdeStore(selectActiveTab);
  const setActiveTab = useIdeStore((state) => state.setActiveTab);
  const closeTab = useIdeStore((state) => state.closeTab);
  const openFile = useIdeStore((state) => state.openFile);
  const setDirExpanded = useIdeStore((state) => state.setDirExpanded);
  const [quickOpen, setQuickOpen] = useState(false);

  const handlePanelKeyDown = useCallback((event: React.KeyboardEvent) => {
    // VS Code-style Cmd/Ctrl+P quick file open.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      setQuickOpen(true);
    }
  }, []);

  useEffect(() => {
    openProject({ environmentId, projectId, cwd, name: projectName });
  }, [environmentId, projectId, cwd, projectName, openProject]);

  // Open a requested file / reveal a requested folder (e.g. opened from a pin).
  useEffect(() => {
    if (openFilePath) {
      openFile(openFilePath, basename(openFilePath));
    }
  }, [openFilePath, projectId, openFile]);
  useEffect(() => {
    if (!revealPath) {
      return;
    }
    // Expand the folder and every ancestor so it's visible in the tree.
    const segments = revealPath.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      setDirExpanded(prefix, true);
    }
  }, [revealPath, projectId, setDirExpanded]);

  const treeStorageKey = `t3code:editor:tree-width:${variant}`;
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const fallback = variant === "page" ? 240 : 176;
    if (typeof window === "undefined") {
      return fallback;
    }
    const stored = Number(window.localStorage.getItem(treeStorageKey));
    return Number.isFinite(stored) && stored >= TREE_MIN_WIDTH ? stored : fallback;
  });
  const startResize = useResizeHandle(setTreeWidth, treeStorageKey);

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col text-foreground"
      onKeyDown={handlePanelKeyDown}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-sm font-medium">Editor</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70" title={cwd}>
          {projectName}
        </span>
        {onClose ? (
          <button
            type="button"
            aria-label="Close editor"
            onClick={onClose}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-card/40"
          style={{ width: treeWidth }}
        >
          <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wide text-muted-foreground/60 uppercase">
            Explorer
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <FileTree environmentId={environmentId} projectId={projectId} cwd={cwd} />
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent"
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabs}
            activeTabPath={activeTab?.path ?? null}
            onSelect={setActiveTab}
            onClose={closeTab}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab ? (
              <EditorArea key={activeTab.path} tab={activeTab} onMention={onMention} />
            ) : (
              <EmptyEditorState />
            )}
          </div>
        </main>
      </div>

      {quickOpen ? (
        <EditorQuickOpen
          environmentId={environmentId}
          cwd={cwd}
          onPick={(path, name) => openFile(path, name)}
          onClose={() => setQuickOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TabBar(props: {
  tabs: IdeTab[];
  activeTabPath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const { tabs, activeTabPath, onSelect, onClose } = props;
  if (tabs.length === 0) {
    return <div className="h-9 shrink-0 border-b border-border" />;
  }
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        const dirty = isTabDirty(tab);
        return (
          <div
            key={tab.path}
            className={cn(
              "group flex items-center gap-1.5 border-r border-border px-3 text-xs",
              isActive
                ? "bg-background text-foreground"
                : "bg-card/40 text-muted-foreground hover:text-foreground",
            )}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 py-0.5"
              onClick={() => onSelect(tab.path)}
              title={tab.path}
            >
              <span className="max-w-44 truncate">{tab.name}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.name}`}
              className="flex size-4 items-center justify-center rounded hover:bg-accent"
              onClick={() => onClose(tab.path)}
            >
              {dirty ? (
                <span className="size-2 rounded-full bg-foreground/70 group-hover:hidden" />
              ) : null}
              <XIcon className={cn("size-3", dirty && "hidden group-hover:block")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EditorArea(props: {
  tab: IdeTab;
  onMention?: ((ref: EditorMentionRef) => void) | undefined;
}) {
  const { tab, onMention } = props;
  const { resolvedTheme } = useTheme();
  const updateBuffer = useIdeStore((state) => state.updateBuffer);
  const setMarkdownView = useIdeStore((state) => state.setMarkdownView);
  const saveTab = useIdeStore((state) => state.saveTab);

  const handleChange = useCallback(
    (value: string) => updateBuffer(tab.path, value),
    [tab.path, updateBuffer],
  );
  const handleSave = useCallback(() => void saveTab(tab.path), [tab.path, saveTab]);
  const handleMention = useMemo(
    () =>
      onMention
        ? (selection: { text: string; fromLine: number; toLine: number }) =>
            onMention({ relativePath: tab.path, ...selection })
        : undefined,
    [onMention, tab.path],
  );

  if (tab.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }

  if (tab.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <FileWarningIcon className="size-6" />
        <p className="text-sm">{tab.errorMessage ?? "Could not open this file."}</p>
      </div>
    );
  }

  if (tab.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <FileWarningIcon className="size-6" />
        <p className="text-sm">This file appears to be binary and can't be edited as text.</p>
      </div>
    );
  }

  const isMarkdown = isMarkdownPath(tab.path);

  return (
    <div className="flex h-full flex-col">
      {isMarkdown ? (
        <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border px-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="xs"
                  variant="outline"
                  pressed={tab.markdownView === "preview"}
                  onPressedChange={() => setMarkdownView(tab.path, "preview")}
                  aria-label="Markdown preview"
                >
                  <EyeIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">Preview</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="xs"
                  variant="outline"
                  pressed={tab.markdownView === "source"}
                  onPressedChange={() => setMarkdownView(tab.path, "source")}
                  aria-label="Markdown source"
                >
                  <PenLineIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">Source</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {isMarkdown ? (
          <MarkdownEditor
            fileName={tab.name}
            value={tab.buffer}
            view={tab.markdownView}
            resolvedTheme={resolvedTheme}
            onChange={handleChange}
            onSave={handleSave}
            onMention={handleMention}
          />
        ) : (
          <CodeMirrorEditor
            fileName={tab.name}
            value={tab.buffer}
            resolvedTheme={resolvedTheme}
            onChange={handleChange}
            onSave={handleSave}
            onMention={handleMention}
          />
        )}
      </div>
    </div>
  );
}

function EmptyEditorState() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground/70">
      Select a file from the Explorer to start editing.
    </div>
  );
}

function useResizeHandle(setWidth: (next: number) => void, storageKey: string) {
  const frame = useRef<number | null>(null);
  return useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const host = event.currentTarget.parentElement;
      const left = host?.getBoundingClientRect().left ?? 0;
      const onMove = (moveEvent: PointerEvent) => {
        if (frame.current !== null) {
          return;
        }
        frame.current = window.requestAnimationFrame(() => {
          frame.current = null;
          const next = Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, moveEvent.clientX - left));
          setWidth(next);
        });
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const next = Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, upEvent.clientX - left));
        window.localStorage.setItem(storageKey, String(next));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setWidth, storageKey],
  );
}
