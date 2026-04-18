import { describe, expect, it } from "vitest";

import {
  buildWorkspaceBreadcrumbSegments,
  formatWorkspaceRelativePath,
  resolveWorkspaceSelectionPath,
} from "./filePathDisplay";

describe("formatWorkspaceRelativePath", () => {
  it("formats absolute workspace paths from the workspace root", () => {
    expect(
      formatWorkspaceRelativePath(
        "C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("prefixes relative paths with the workspace root label", () => {
    expect(
      formatWorkspaceRelativePath(
        "apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("keeps paths already rooted at the workspace label stable", () => {
    expect(
      formatWorkspaceRelativePath(
        "t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("preserves columns when present", () => {
    expect(
      formatWorkspaceRelativePath(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501:9",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501:9");
  });

  it("builds breadcrumb segments from the workspace root instead of the filesystem root", () => {
    expect(
      buildWorkspaceBreadcrumbSegments(
        "/Users/me/projects/DriveAgent/docs/google-workspace-v2-plan.md",
        "/Users/me/projects/DriveAgent",
      ),
    ).toEqual(["DriveAgent", "docs", "google-workspace-v2-plan.md"]);
  });

  it("resolves an absolute path inside the workspace to a workspace-relative selection path", () => {
    expect(
      resolveWorkspaceSelectionPath(
        "/Users/me/projects/DriveAgent/docs/google-workspace-v2-plan.md:12",
        "/Users/me/projects/DriveAgent",
      ),
    ).toBe("docs/google-workspace-v2-plan.md");
  });

  it("resolves a path already rooted at the workspace label", () => {
    expect(
      resolveWorkspaceSelectionPath(
        "DriveAgent/docs/google-workspace-v2-plan.md",
        "/Users/me/projects/DriveAgent",
      ),
    ).toBe("docs/google-workspace-v2-plan.md");
  });
});
