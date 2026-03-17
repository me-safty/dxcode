import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const EDITORS = [
  { id: "cursor", label: "Cursor", command: "cursor" },
  { id: "vscode", label: "VS Code", command: "code" },
  { id: "zed", label: "Zed", command: "zed" },
  { id: "antigravity", label: "Antigravity", command: "agy" },
  { id: "file-manager", label: "File Manager", command: null },
] as const;

export const EditorId = Schema.Literals(EDITORS.map((e) => e.id));
export type EditorId = typeof EditorId.Type;

export const OpenInEditorInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  editor: EditorId,
});
export type OpenInEditorInput = typeof OpenInEditorInput.Type;

export const TERMINALS = [
  { id: "terminal-app", label: "Terminal.app" },
  { id: "iterm2", label: "iTerm2" },
  { id: "warp", label: "Warp" },
  { id: "ghostty", label: "Ghostty" },
  { id: "kitty", label: "Kitty" },
  { id: "alacritty", label: "Alacritty" },
] as const;

export const TerminalId = Schema.Literals(TERMINALS.map((t) => t.id));
export type TerminalId = typeof TerminalId.Type;

export const OpenInTerminalInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sessionId: Schema.optional(TrimmedNonEmptyString),
  terminal: Schema.optional(TerminalId),
});
export type OpenInTerminalInput = typeof OpenInTerminalInput.Type;

/** @deprecated Use `OpenInTerminalInput` instead. */
export const OpenInWarpInput = OpenInTerminalInput;
/** @deprecated Use `OpenInTerminalInput` instead. */
export type OpenInWarpInput = OpenInTerminalInput;
