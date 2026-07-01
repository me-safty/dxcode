import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

describe("ThreadErrorBanner", () => {
  it("renders the full error inline instead of clamping it behind a tooltip", () => {
    const error =
      "Standalone chat bootstrap must target the reserved chat project.\nThe current payload targeted project-workspace-123.";
    const markup = renderToStaticMarkup(<ThreadErrorBanner error={error} />);

    expect(markup).toContain("Message failed");
    expect(markup).toContain("Standalone chat bootstrap must target the reserved chat project.");
    expect(markup).toContain("The current payload targeted project-workspace-123.");
    expect(markup).toContain("whitespace-pre-wrap");
    expect(markup).not.toContain("line-clamp");
  });
});
