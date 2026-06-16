import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import { useCallback, useState, type ReactNode } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildDiffReviewComment } from "~/reviewCommentContext";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { LocalCommentAnnotation } from "../files/LocalCommentAnnotation";
import { nextFileCommentId } from "../files/fileCommentAnnotations";

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;

interface AnnotatableFileDiffProps {
  fileDiff: FileDiffMetadata;
  filePath: string;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  options: FileDiffProps<DiffCommentAnnotationGroup>["options"];
  renderHeaderPrefix: (fileDiff: FileDiffMetadata) => ReactNode;
}

export function AnnotatableFileDiff({
  fileDiff,
  filePath,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  options,
  renderHeaderPrefix,
}: AnnotatableFileDiffProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null);
  const [lineAnnotations, setLineAnnotations] = useState<DiffCommentLineAnnotation[]>([]);

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) =>
        current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        }),
      );
    },
    [composerDraftTarget, removeReviewComment],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (!entry) return;

      const comment = buildDiffReviewComment({
        id: entry.id,
        sectionId,
        sectionTitle,
        filePath,
        fileDiff,
        range: entry.range,
        text,
      });
      if (comment) {
        addReviewComment(composerDraftTarget, comment);
      }
      setSelectedRange(null);
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? { ...annotationEntry, kind: "comment", text }
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [
      addReviewComment,
      composerDraftTarget,
      fileDiff,
      filePath,
      lineAnnotations,
      sectionId,
      sectionTitle,
    ],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange) => {
      const id = nextFileCommentId();
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath,
        fileDiff,
        range,
        text: "",
      });
      if (!comment) return;

      const side: AnnotationSide =
        (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
      const draftEntry: DiffCommentAnnotationEntry = {
        id,
        kind: "draft",
        range,
        rangeLabel: comment.rangeLabel,
        text: "",
      };
      setLineAnnotations((current) => {
        const withoutDraft = current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
        const annotationIndex = withoutDraft.findIndex(
          (annotation) => annotation.side === side && annotation.lineNumber === range.end,
        );
        if (annotationIndex < 0) {
          return [
            ...withoutDraft,
            {
              side,
              lineNumber: range.end,
              metadata: { entries: [draftEntry] },
            },
          ];
        }
        return withoutDraft.map((annotation, index) =>
          index === annotationIndex
            ? {
                ...annotation,
                metadata: { entries: [...annotation.metadata.entries, draftEntry] },
              }
            : annotation,
        );
      });
    },
    [fileDiff, filePath, sectionId, sectionTitle],
  );

  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) beginComment(range);
    },
    [beginComment],
  );

  return (
    <FileDiff<DiffCommentAnnotationGroup>
      fileDiff={fileDiff}
      renderHeaderPrefix={renderHeaderPrefix}
      options={{
        ...options,
        enableGutterUtility: !hasOpenCommentForm,
        enableLineSelection: !hasOpenCommentForm,
        onGutterUtilityClick: setSelectedRange,
        onLineSelectionChange: setSelectedRange,
        onLineSelectionEnd: handleLineSelectionEnd,
      }}
      selectedLines={selectedRange}
      lineAnnotations={lineAnnotations}
      renderAnnotation={(annotation) => (
        <div className="py-1">
          {annotation.metadata.entries.map((entry) => (
            <LocalCommentAnnotation
              key={entry.id}
              kind={entry.kind}
              rangeLabel={entry.rangeLabel}
              text={entry.text}
              onCancel={() => removeAnnotationEntry(entry.id)}
              onComment={(text) => submitAnnotationEntry(entry.id, text)}
              onDelete={() => removeAnnotationEntry(entry.id)}
            />
          ))}
        </div>
      )}
    />
  );
}
