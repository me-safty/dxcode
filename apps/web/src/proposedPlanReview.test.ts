import { describe, expect, it } from "vitest";

import {
  appendPlanReviewFeedbackToDraft,
  formatPlanReviewFeedback,
  formatPlanReviewQuote,
  normalizePlanReviewSelectionText,
  type PlanReviewAnnotation,
} from "./proposedPlanReview";

function annotation(
  input: Partial<PlanReviewAnnotation> & Pick<PlanReviewAnnotation, "quote" | "comment">,
): PlanReviewAnnotation {
  return {
    id: input.id ?? "annotation-1",
    quote: input.quote,
    comment: input.comment,
    createdAt: input.createdAt ?? "2026-05-29T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-29T00:00:00.000Z",
  };
}

describe("normalizePlanReviewSelectionText", () => {
  it("trims outer whitespace and normalizes newlines", () => {
    expect(normalizePlanReviewSelectionText(" \r\n selected\r\ntext \n")).toBe("selected\ntext");
  });
});

describe("formatPlanReviewQuote", () => {
  it("formats a single-line quote", () => {
    expect(formatPlanReviewQuote("selected quote")).toBe("> selected quote");
  });

  it("formats multiline quotes with blank lines", () => {
    expect(formatPlanReviewQuote("line 1\n\nline 2")).toBe("> line 1\n>\n> line 2");
  });
});

describe("formatPlanReviewFeedback", () => {
  it("formats quote/comment feedback", () => {
    expect(
      formatPlanReviewFeedback([
        annotation({
          quote: "selected quote",
          comment: "This needs more detail.",
        }),
      ]),
    ).toBe("> selected quote\n\nThis needs more detail.");
  });

  it("filters annotations with empty quotes or comments", () => {
    expect(
      formatPlanReviewFeedback([
        annotation({ id: "empty-quote", quote: " ", comment: "comment" }),
        annotation({ id: "empty-comment", quote: "quote", comment: " " }),
        annotation({ id: "valid", quote: "keep this", comment: "keep comment" }),
      ]),
    ).toBe("> keep this\n\nkeep comment");
  });
});

describe("appendPlanReviewFeedbackToDraft", () => {
  it("appends to an empty composer draft", () => {
    expect(appendPlanReviewFeedbackToDraft("", "> quote\n\ncomment")).toBe("> quote\n\ncomment");
  });

  it("appends to non-empty composer draft with exactly two blank lines", () => {
    expect(appendPlanReviewFeedbackToDraft("Existing feedback\n\n", "> quote\n\ncomment")).toBe(
      "Existing feedback\n\n> quote\n\ncomment",
    );
  });
});
