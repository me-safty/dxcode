/** Shared types for the T3 Code CLI. */

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolUse?: ToolUse[];
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
}

export type FileChangeType = "create" | "modify" | "delete" | "move";

export interface FileChange {
  type: FileChangeType;
  path: string;
  originalContent?: string;
  newContent?: string;
  /** For move: the destination path */
  destPath?: string;
}

export interface CodeSession {
  messages: Message[];
  workingDirectory: string;
  currentTask?: string;
  savedAt: number;
}
