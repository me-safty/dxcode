import { useEffect, useRef, useState } from "react";
import { MessageSquarePlusIcon, SearchIcon, XIcon } from "lucide-react";

import { Crepe } from "@milkdown/crepe";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

import type { IdeMarkdownView } from "../../ideStore";
import { CodeMirrorEditor, type EditorSelectionRef } from "./CodeMirrorEditor";

interface MarkdownEditorProps {
  fileName: string;
  value: string;
  view: IdeMarkdownView;
  resolvedTheme: "light" | "dark";
  onChange: (value: string) => void;
  onSave?: (() => void) | undefined;
  onMention?: ((selection: EditorSelectionRef) => void) | undefined;
}

/**
 * Markdown editor with two modes:
 *  - "preview": a Milkdown Crepe WYSIWYG editor (edit the rendered document).
 *  - "source": the raw markdown in the CodeMirror editor.
 *
 * The active mode is controlled by the parent; switching simply mounts the
 * other editor, which initializes from the current `value`.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { fileName, value, view, resolvedTheme, onChange, onSave, onMention } = props;

  if (view === "source") {
    return (
      <CodeMirrorEditor
        fileName={fileName}
        value={value}
        resolvedTheme={resolvedTheme}
        onChange={onChange}
        onSave={onSave}
        onMention={onMention}
      />
    );
  }

  return <CrepeWysiwyg value={value} onChange={onChange} onSave={onSave} onMention={onMention} />;
}

const FIND_HIGHLIGHT = "ide-md-find";

/** Highlight occurrences of `query` inside `container` via the CSS Highlight API. */
function applyFindHighlight(container: HTMLElement, query: string): number {
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (
    globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (!highlights || !HighlightCtor) {
    return 0;
  }
  highlights.delete(FIND_HIGHLIGHT);
  const needle = query.toLowerCase();
  if (needle.length === 0) {
    return 0;
  }
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue?.toLowerCase() ?? "";
    let index = text.indexOf(needle);
    while (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      ranges.push(range);
      index = text.indexOf(needle, index + needle.length);
    }
    node = walker.nextNode();
  }
  if (ranges.length > 0) {
    highlights.set(FIND_HIGHLIGHT, new HighlightCtor(...ranges));
    ranges[0]!.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }
  return ranges.length;
}

function clearFindHighlight(): void {
  (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete(FIND_HIGHLIGHT);
}

function CrepeWysiwyg(props: {
  value: string;
  onChange: (value: string) => void;
  onSave?: (() => void) | undefined;
  onMention?: ((selection: EditorSelectionRef) => void) | undefined;
}) {
  const { value, onChange, onSave, onMention } = props;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const [chatTip, setChatTip] = useState<{ top: number; left: number; text: string } | null>(null);
  const [find, setFind] = useState<{ query: string; count: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    // Milkdown round-trips markdown through ProseMirror, so the very first
    // emission after mount is the (possibly reformatted) initial document. We
    // skip it so merely opening a file in preview mode does not mark it dirty;
    // genuine edits after mount are propagated.
    let initialized = false;

    const crepe = new Crepe({ root: host, defaultValue: value });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!initialized) {
          initialized = true;
          return;
        }
        onChangeRef.current(markdown);
      });
    });
    crepeRef.current = crepe;

    void crepe.create();

    return () => {
      crepeRef.current = null;
      clearFindHighlight();
      void crepe.destroy();
    };
    // Mount once per preview session; `value` is captured as the initial doc.
    // Switching files/modes remounts via React (different tab key / branch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a "Chat" button over non-empty selections inside the rendered doc.
  const refreshSelection = () => {
    if (!onMention) {
      return;
    }
    const host = hostRef.current;
    const preview = previewRef.current;
    const selection = window.getSelection();
    if (!host || !preview || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setChatTip(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setChatTip(null);
      return;
    }
    const text = selection.toString();
    if (text.trim().length === 0) {
      setChatTip(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    setChatTip({
      top: rect.top - previewRect.top - 34,
      left: rect.left - previewRect.left,
      text,
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      const crepe = crepeRef.current;
      if (crepe) {
        onChangeRef.current(crepe.getMarkdown());
      }
      onSaveRef.current?.();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFind((current) => current ?? { query: "", count: 0 });
    } else if (event.key === "Escape" && find) {
      event.preventDefault();
      clearFindHighlight();
      setFind(null);
    }
  };

  return (
    <div
      ref={previewRef}
      className="ide-markdown-preview relative h-full w-full"
      onKeyDown={handleKeyDown}
      onMouseUp={() => window.setTimeout(refreshSelection, 0)}
    >
      {/* Let Milkdown own its own scroll container — the block-edit drag plugin
          computes drop targets against the editor's scroller, so wrapping it in
          another overflow container breaks drag-to-reorder. */}
      <div ref={hostRef} className="ide-milkdown-host h-full w-full" />

      {chatTip && onMention ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onMention({ text: chatTip.text, fromLine: 0, toLine: 0 });
            setChatTip(null);
          }}
          style={{ top: Math.max(chatTip.top, 2), left: chatTip.left }}
          className="absolute z-20 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent"
        >
          <MessageSquarePlusIcon className="size-3.5 text-primary" />
          Chat
        </button>
      ) : null}

      {find ? (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 shadow-md">
          <SearchIcon className="size-3.5 text-muted-foreground/70" />
          <input
            autoFocus
            value={find.query}
            placeholder="Find"
            onChange={(event) => {
              const query = event.target.value;
              const count = hostRef.current ? applyFindHighlight(hostRef.current, query) : 0;
              setFind({ query, count });
            }}
            className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <span className="text-xs text-muted-foreground/60">{find.query ? find.count : ""}</span>
          <button
            type="button"
            aria-label="Close find"
            onClick={() => {
              clearFindHighlight();
              setFind(null);
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
