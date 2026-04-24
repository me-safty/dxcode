import { describe, expect, it } from "vitest";

import { explorationEntryHeading } from "./ExplorationCard";
import type { WorkLogEntry } from "../../session-logic";

function makeEntry(overrides: Partial<WorkLogEntry>): WorkLogEntry {
  return {
    id: "entry-1",
    createdAt: "2026-04-23T22:21:10.000Z",
    label: "Read File",
    tone: "tool",
    activityKind: "tool.completed",
    ...overrides,
  } as WorkLogEntry;
}

describe("explorationEntryHeading", () => {
  it("returns the structured path when toolInput carries one", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        toolName: "read",
        toolInput: { file_path: "/Users/dev/marcode/apps/web/src/App.tsx" },
      }),
    );
    expect(heading).toBe("Read apps/web/src/App.tsx");
  });

  // The regression the user reported: Cursor ACP emits `rawOutput.content`
  // for Read File (the actual file contents). session-logic summarizes that
  // as `entry.detail`, which previously tripped `extractFilePathFromValue`'s
  // loose "contains a slash" check — any import line with `@scope/pkg` was
  // treated as a path, producing headings like
  //   `Read import { ProviderKind } from "@marcode/contracts";`
  // instead of the intended `Read file`.
  it("falls back to 'Read file' when the detail is a source line, not a path", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        toolName: "read",
        toolInput: {},
        detail: 'import { ProviderKind } from "@marcode/contracts";',
      }),
    );
    expect(heading).toBe("Read file");
  });

  it("falls back to 'Read file' when the detail is a multi-token code snippet", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        toolName: "read",
        detail: "const x = foo.bar/baz(arg);",
      }),
    );
    expect(heading).toBe("Read file");
  });

  it("still accepts bare path-like strings in detail", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        toolName: "read",
        detail: "apps/web/src/App.tsx",
      }),
    );
    expect(heading).toBe("Read apps/web/src/App.tsx");
  });

  it("still accepts XML-wrapped paths from Codex/Cursor detail", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        toolName: "read",
        detail: "<path>/Users/dev/marcode/packages/contracts/src/index.ts</path>",
      }),
    );
    expect(heading).toBe("Read packages/contracts/src/index.ts");
  });

  it("defaults Cursor file_read rows with no path info to 'Read file'", () => {
    const heading = explorationEntryHeading(
      makeEntry({
        itemType: "file_read",
        toolName: "read",
        toolInput: {},
      }),
    );
    expect(heading).toBe("Read file");
  });
});
