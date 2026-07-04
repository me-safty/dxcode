import type { SourceItemMetadata } from "./Services/WorkflowSourceCommitter.ts";

/**
 * Canonical serialization of source metadata. The committer writes this exact
 * shape into p_workflow_boards_work_source_mapping.source_metadata_json so
 * metadata-only upstream changes can be compared byte-for-byte by the diff layer.
 */
export const serializeSourceMetadata = (metadata: SourceItemMetadata): string =>
  JSON.stringify({
    provider: metadata.provider,
    url: metadata.url ?? null,
    assignees: metadata.assignees ?? [],
    labels: metadata.labels ?? [],
    lifecycle: metadata.lifecycle ?? null,
  });
