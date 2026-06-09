export interface PlanReviewAnnotation {
  id: string;
  quote: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanReviewAnnotationDraft {
  quote: string;
  comment: string;
}

function normalizePlanReviewText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function normalizePlanReviewSelectionText(text: string): string {
  return normalizePlanReviewText(text);
}

export function formatPlanReviewQuote(quote: string): string {
  const normalizedQuote = normalizePlanReviewSelectionText(quote);
  if (normalizedQuote.length === 0) {
    return "";
  }

  return normalizedQuote
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function formatPlanReviewFeedback(annotations: readonly PlanReviewAnnotation[]): string {
  return annotations
    .flatMap((annotation) => {
      const quote = formatPlanReviewQuote(annotation.quote);
      const comment = normalizePlanReviewText(annotation.comment);
      if (quote.length === 0 || comment.length === 0) {
        return [];
      }
      return [`${quote}\n\n${comment}`];
    })
    .join("\n\n");
}

export function appendPlanReviewFeedbackToDraft(existingDraft: string, feedback: string): string {
  const normalizedFeedback = normalizePlanReviewText(feedback);
  if (normalizedFeedback.length === 0) {
    return existingDraft;
  }

  const trimmedDraft = existingDraft.trimEnd();
  if (trimmedDraft.length === 0) {
    return normalizedFeedback;
  }

  return `${trimmedDraft}\n\n${normalizedFeedback}`;
}
