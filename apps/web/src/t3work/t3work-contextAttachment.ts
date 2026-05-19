export type T3WorkContextAttachmentSyncItem = {
  id: string;
  label: string;
  detail?: string;
  status: "completed" | "active" | "pending";
  sizeBytes?: number;
};

export type T3WorkContextAttachmentSyncInfo = {
  contentLabel?: string;
  currentItemLabel?: string;
  currentItemDetail?: string;
  bytesCurrent?: number;
  bytesTotal?: number;
  startedAt?: string;
  items?: ReadonlyArray<T3WorkContextAttachmentSyncItem>;
};

export type T3WorkContextAttachment = {
  id: string;
  kind: string;
  label: string;
  jiraIssueType?: string;
  jiraIssueTypeIconUrl?: string;
  dedupeKey?: string;
  description?: string;
  summaryItems?: ReadonlyArray<{ label: string; value: string }>;
  fileReferences?: ReadonlyArray<{ label: string; relativePath: string }>;
  syncStatus?: "syncing" | "synced" | "error";
  syncPhase?: string;
  syncProgressCurrent?: number;
  syncProgressTotal?: number;
  syncInfo?: T3WorkContextAttachmentSyncInfo;
  syncedAt?: string;
  syncError?: string;
  contextText: string;
};
