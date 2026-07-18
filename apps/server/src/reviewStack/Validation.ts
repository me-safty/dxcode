import type {
  ReviewStackAnchor,
  ReviewStackDocument,
  ReviewStackLayer,
  ReviewStackRange,
} from "@t3tools/contracts";

const MAX_TEXT = 4_000;
const MAX_DIAGRAM = 8_000;

const cap = (value: string, max = MAX_TEXT): string => value.trim().slice(0, max);

/** Enforce coverage and anchor integrity after provider schema decoding. */
export function validateReviewStackDocument(
  document: ReviewStackDocument,
  anchors: ReadonlyArray<ReviewStackAnchor>,
): ReviewStackDocument {
  const known = new Set(anchors.map((anchor) => anchor.id));
  const used = new Set<string>();
  const layers: ReviewStackLayer[] = [];

  for (const layer of document.layers) {
    const ranges: ReviewStackRange[] = [];
    for (const range of layer.ranges) {
      if (!known.has(range.anchorId) || used.has(range.anchorId)) continue;
      used.add(range.anchorId);
      ranges.push({
        anchorId: range.anchorId,
        summary: cap(range.summary),
        risks: range.risks.map((risk) => ({
          severity: risk.severity,
          summary: cap(risk.summary),
          evidence: cap(risk.evidence),
        })),
      });
    }
    if (ranges.length === 0) continue;
    layers.push({
      id: cap(layer.id),
      title: cap(layer.title),
      summary: cap(layer.summary),
      ranges,
      diagram:
        layer.diagram === null
          ? null
          : { title: cap(layer.diagram.title), text: cap(layer.diagram.text, MAX_DIAGRAM) },
    });
  }

  if (anchors.length > 0 && used.size === 0) {
    throw new Error("Review stack output has zero valid anchor coverage.");
  }

  const missing = anchors.filter((anchor) => !used.has(anchor.id));
  if (missing.length > 0) {
    layers.push({
      id: "other-changes",
      title: "Other changes",
      summary: "Changes not grouped by the generated review.",
      diagram: null,
      ranges: missing.map((anchor) => ({
        anchorId: anchor.id,
        summary: `Changes in ${anchor.path}.`,
        risks: [],
      })),
    });
  }
  return { summary: cap(document.summary), layers };
}
