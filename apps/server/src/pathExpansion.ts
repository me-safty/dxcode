import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand a leading `~` (or `~/…`) in a user-supplied path to the current
 * user's home directory. Spawned processes don't get shell expansion, so
 * env vars like `CODEX_HOME=~/.codex-work` or `CLAUDE_CONFIG_DIR=~/.claude`
 * would be passed verbatim and treated as relative paths by the receiver.
 *
 * Returns the input unchanged if it doesn't start with `~` or is empty.
 * Does not handle `~user` (other-user) expansion — only `~` and `~/…`.
 */
export function expandHomePath(value: string): string {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}
