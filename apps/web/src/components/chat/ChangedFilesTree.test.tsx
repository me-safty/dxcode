import { TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChangedFilesTree } from "./ChangedFilesTree";

describe("ChangedFilesTree", () => {
  it("renders nested directories collapsed on the first render when collapse-all is active", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesTree
        turnId={TurnId.makeUnsafe("turn-1")}
        files={[
          { path: "apps/web/src/index.ts", additions: 2, deletions: 1 },
          { path: "apps/web/src/main.ts", additions: 3, deletions: 0 },
        ]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain("apps/web/src");
    expect(markup).not.toContain("index.ts");
    expect(markup).not.toContain("main.ts");
  });
});
