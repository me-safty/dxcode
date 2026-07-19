import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerQueuedMessages } from "./ComposerQueuedMessages";

describe("ComposerQueuedMessages", () => {
  it("renders queued text with steer, delete, and edit actions", () => {
    const markup = renderToStaticMarkup(
      <ComposerQueuedMessages
        messages={[{ id: "queued-1", text: "how are you" }]}
        disabled={false}
        onSteer={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Queued messages"');
    expect(markup).toContain("how are you");
    expect(markup).toContain("Steer");
    expect(markup).toContain("Delete queued message: how are you");
    expect(markup).toContain("Edit queued message: how are you");
    expect(markup).toContain("Edit");
  });
});
