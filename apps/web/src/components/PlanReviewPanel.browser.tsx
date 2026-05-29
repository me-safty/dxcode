import "../index.css";

import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ProposedPlan } from "../types";
import type { PlanReviewAnnotation } from "../proposedPlanReview";
import { PlanReviewPanel } from "./PlanReviewPanel";

const PROPOSED_PLAN: ProposedPlan = {
  id: "plan-review-browser-test" as never,
  turnId: null,
  planMarkdown: "# Reviewable plan\n\n- Keep composer stable.\n- Add success criteria.",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
};

function findTextNode(root: Node, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.includes(text)) {
      return node as Text;
    }
    node = walker.nextNode();
  }
  throw new Error(`Unable to find text node containing "${text}".`);
}

function selectText(root: HTMLElement, text: string) {
  const textNode = findTextNode(root, text);
  const start = textNode.textContent?.indexOf(text) ?? -1;
  if (start < 0) {
    throw new Error(`Unable to find selection text "${text}".`);
  }
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + text.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function Harness(props: { onDone: () => void }) {
  const [annotations, setAnnotations] = useState<PlanReviewAnnotation[]>([]);
  return (
    <div className="h-[720px] w-[720px]">
      <PlanReviewPanel
        proposedPlan={PROPOSED_PLAN}
        markdownCwd={undefined}
        annotations={annotations}
        onAnnotationsChange={setAnnotations}
        onDone={props.onDone}
        onBack={vi.fn()}
      />
    </div>
  );
}

describe("PlanReviewPanel", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("creates a visual comment from selected plan text and enables done", async () => {
    const onDone = vi.fn();
    await render(<Harness onDone={onDone} />);

    let reviewRoot: HTMLElement | null = null;
    await vi.waitFor(() => {
      reviewRoot = document.querySelector<HTMLElement>('[data-testid="plan-review-markdown"]');
      expect(reviewRoot).toBeTruthy();
    });
    selectText(reviewRoot!, "Add success criteria.");

    await page.getByText("Comment", { exact: true }).click();
    await page.getByPlaceholder("Add a comment").fill("Needs acceptance coverage.");
    await page.getByText("Save", { exact: true }).click();

    await expect.element(page.getByText("Needs acceptance coverage.")).toBeInTheDocument();
    await expect.element(page.getByText("Add success criteria.").first()).toBeInTheDocument();

    await page.getByText("Done", { exact: true }).click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
