import { useEffect, useRef, useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import { loadLanguageForFile } from "./cmLanguage";

interface CodeMirrorEditorProps {
  /** File name, used for language detection. */
  fileName: string;
  /** Initial document. Changing this (e.g. switching files) resets the editor. */
  value: string;
  resolvedTheme: "light" | "dark";
  readOnly?: boolean;
  onChange: (value: string) => void;
  /** Invoked on Cmd/Ctrl+S. Returning prevents the browser save dialog. */
  onSave?: (() => void) | undefined;
  /** When provided, a "Chat" button appears over non-empty selections. */
  onMention?: ((selection: EditorSelectionRef) => void) | undefined;
}

export interface EditorSelectionRef {
  text: string;
  fromLine: number;
  toLine: number;
}

interface SelectionTip {
  top: number;
  left: number;
  selection: EditorSelectionRef;
}

function baseExtensions(readOnly: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // VS Code-style find: Cmd+F opens the search panel (top), Cmd+G next, etc.
    search({ top: true }),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    // Keymap precedence: bracket/search/default… then a Cmd+/ comment toggle.
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      { key: "Mod-/", run: toggleComment },
      indentWithTab,
    ]),
  ];
}

/**
 * A CodeMirror 6 editor. The instance is created once per mounted file; the
 * theme and language are swapped via compartments without tearing down state.
 */
export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  const { fileName, value, resolvedTheme, readOnly = false, onChange, onSave, onMention } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const [tip, setTip] = useState<SelectionTip | null>(null);

  // Keep the latest callbacks without recreating the editor on each render.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const mentionEnabledRef = useRef(Boolean(onMention));
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  mentionEnabledRef.current = Boolean(onMention);

  // Create the editor once per file. `fileName` in the dep array ensures a
  // fresh document/state when a different file mounts into the same slot.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet || update.geometryChanged) {
        const sel = update.state.selection.main;
        if (mentionEnabledRef.current && !sel.empty) {
          const coords = update.view.coordsAtPos(sel.from);
          const hostRect = host.getBoundingClientRect();
          if (coords) {
            setTip({
              top: coords.top - hostRect.top,
              left: coords.left - hostRect.left,
              selection: {
                text: update.state.sliceDoc(sel.from, sel.to),
                fromLine: update.state.doc.lineAt(sel.from).number,
                toLine: update.state.doc.lineAt(sel.to).number,
              },
            });
            return;
          }
        }
        setTip(null);
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        saveKeymap,
        ...baseExtensions(readOnly),
        themeCompartment.current.of(resolvedTheme === "dark" ? oneDark : []),
        languageCompartment.current.of([]),
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    let cancelled = false;
    void loadLanguageForFile(fileName).then((language) => {
      if (cancelled || viewRef.current !== view) {
        return;
      }
      view.dispatch({ effects: languageCompartment.current.reconfigure(language) });
    });

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when the file identity or read-only flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, readOnly]);

  // Swap theme without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: themeCompartment.current.reconfigure(resolvedTheme === "dark" ? oneDark : []),
    });
  }, [resolvedTheme]);

  // Reflect external value changes (e.g. reload from disk) that don't originate
  // from typing in this editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
    // We intentionally exclude `value` churn from typing; the guard above makes
    // this idempotent for in-editor edits.
  }, [value]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="ide-codemirror-host h-full w-full overflow-hidden" />
      {tip && onMention ? (
        <button
          type="button"
          // Don't clear the selection when pressing the button.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onMention(tip.selection);
            setTip(null);
          }}
          style={{ top: Math.max(tip.top - 30, 2), left: tip.left }}
          className="absolute z-20 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent"
        >
          <MessageSquarePlusIcon className="size-3.5 text-primary" />
          Chat
        </button>
      ) : null}
    </div>
  );
}
