import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { buildThreadFilesNavigation, buildThreadFilesRoutePath } from "./routes";

const thread = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("thread file routes", () => {
  it("includes an optional source line in string routes", () => {
    expect(buildThreadFilesRoutePath(thread, "src/main.ts", 42)).toBe(
      "/threads/environment-1/thread-1/files?path=src%2Fmain.ts&line=42",
    );
  });

  it("builds typed navigation params for a file and source line", () => {
    expect(buildThreadFilesNavigation(thread, "src/main.ts", 42)).toEqual({
      pathname: "/threads/[environmentId]/[threadId]/files",
      params: {
        environmentId: "environment-1",
        threadId: "thread-1",
        path: "src/main.ts",
        line: "42",
      },
    });
  });
});
