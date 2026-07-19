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
    throw new Error(
      `Review stack output is incomplete: ${missing.length} of ${anchors.length} anchors were not inspected (${missing
        .slice(0, 8)
        .map((anchor) => anchor.id)
        .join(", ")}${missing.length > 8 ? ", …" : ""}).`,
    );
  }
  const layerIds = new Set(layers.map((layer) => layer.id));
  const paths = new Set(
    anchors
      .flatMap((anchor) => [anchor.path, anchor.previousPath])
      .filter((path): path is string => path !== null),
  );
  const referenceKeys = new Set<string>();
  const references = document.references?.filter((reference) => {
    const value = reference._tag === "layer" ? reference.layerId : reference.path;
    const valid = reference._tag === "layer" ? layerIds.has(value) : paths.has(value);
    const key = `${reference._tag}:${value}`;
    if (!valid || referenceKeys.has(key)) return false;
    referenceKeys.add(key);
    return true;
  });

  return {
    summary: cap(document.summary),
    ...(document.mergeAssessment
      ? {
          mergeAssessment: {
            ...document.mergeAssessment,
            rationale: cap(document.mergeAssessment.rationale),
          },
        }
      : {}),
    ...(references ? { references } : {}),
    layers,
  };
}
