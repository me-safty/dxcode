import { describe, expect, it } from "vitest";

import { applyToolCallHint } from "./CursorAdapter.ts";
import type { AcpToolCallState } from "../acp/AcpRuntimeModel.ts";

// Cursor ACP only emits the real command text in `session/request_permission`
// (the title is backtick-wrapped, e.g. `` `rg -i 'effect'` ``). The subsequent
// `session/update` tool_call just says `title: "Terminal"` with empty
// `rawInput`. The adapter stashes the permission-request command and merges it
// into the tool_call state via `applyToolCallHint` — without this the user
// only sees a blank "Ran command" pill.
describe("applyToolCallHint", () => {
  const baseState: AcpToolCallState = {
    toolCallId: "tool-1",
    kind: "execute",
    title: "Ran command",
    status: "inProgress",
    data: { toolCallId: "tool-1", kind: "execute", toolName: "execute", rawInput: {} },
  };

  it("returns the state unchanged when no hint is present", () => {
    expect(applyToolCallHint(baseState, undefined)).toBe(baseState);
  });

  it("fills in the command when the tool_call state lacks one", () => {
    const merged = applyToolCallHint(baseState, { command: "rg -i 'effect' --stats" });
    expect(merged.command).toBe("rg -i 'effect' --stats");
    expect(merged.data.command).toBe("rg -i 'effect' --stats");
  });

  // Critical: detail is reserved for stdout/stderr output. If we populated
  // detail with the command text, CommandExecutionCard's duplicate guard would
  // suppress the stdout body because detail === command. Keep it untouched.
  it("never writes the command into `detail` even when detail was empty", () => {
    const merged = applyToolCallHint(baseState, { command: "rg -i 'effect' --stats" });
    expect(merged.detail).toBeUndefined();
  });

  it("does not overwrite an existing command", () => {
    const stateWithCommand: AcpToolCallState = {
      ...baseState,
      command: "bun run lint",
      detail: "bun run lint",
      data: { ...baseState.data, command: "bun run lint" },
    };
    const merged = applyToolCallHint(stateWithCommand, { command: "different command" });
    expect(merged.command).toBe("bun run lint");
    expect(merged.data.command).toBe("bun run lint");
  });

  it("preserves any existing detail (which represents output, not command)", () => {
    const stateWithDetail: AcpToolCallState = {
      ...baseState,
      detail: "existing output",
    };
    const merged = applyToolCallHint(stateWithDetail, { command: "ls" });
    expect(merged.command).toBe("ls");
    expect(merged.detail).toBe("existing output");
  });
});
