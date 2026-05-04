import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AnimatedHeight } from "./AnimatedHeight";

function Harness() {
  const [expanded, setExpanded] = useState(false);

  return (
    <AnimatedHeight>
      <button type="button" onClick={() => setExpanded((value) => !value)}>
        Toggle
      </button>
      <input aria-label="Focused field" className="focus:outline-2" />
      {expanded ? <div style={{ height: 40 }}>More content</div> : null}
    </AnimatedHeight>
  );
}

async function waitForAnimatedHeightElement(): Promise<HTMLElement> {
  await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-slot='animated-height']");
    expect(element).not.toBeNull();
  });

  const element = document.querySelector<HTMLElement>("[data-slot='animated-height']");
  if (!element) throw new Error("AnimatedHeight element not found");
  return element;
}

describe("AnimatedHeight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not clip focus rings after the height measurement settles", async () => {
    const screen = await render(<Harness />);

    try {
      const element = await waitForAnimatedHeightElement();

      await vi.waitFor(() => {
        expect(element.style.height).not.toBe("");
        expect(getComputedStyle(element).overflow).toBe("visible");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("clips only while height changes are animating", async () => {
    const screen = await render(<Harness />);

    try {
      const element = await waitForAnimatedHeightElement();

      await vi.waitFor(() => {
        expect(getComputedStyle(element).overflow).toBe("visible");
      });

      document.querySelector<HTMLButtonElement>("button")?.click();

      await vi.waitFor(() => {
        expect(getComputedStyle(element).overflow).toBe("hidden");
      });

      element.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "height" }));

      await vi.waitFor(() => {
        expect(getComputedStyle(element).overflow).toBe("visible");
      });
    } finally {
      await screen.unmount();
    }
  });
});
