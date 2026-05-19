import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";

export type PendingChatContextItem = {
  projectId: string;
  attachment: T3WorkContextAttachment;
  createdAt: string;
};

export type PendingKickoffContextItem = {
  projectId: string;
  ticketId: string;
  attachment: T3WorkContextAttachment;
  createdAt: string;
};

export type T3WorkAddToChatState = {
  pendingByProjectId: Record<string, PendingChatContextItem[]>;
  pendingByKickoffKey: Record<string, PendingKickoffContextItem[]>;
  threadAttachmentsByThreadId: Record<string, T3WorkContextAttachment[]>;
  enqueue: (item: PendingChatContextItem) => void;
  enqueueKickoff: (item: PendingKickoffContextItem) => void;
  enqueueThreadAttachment: (threadId: string, attachment: T3WorkContextAttachment) => void;
  replaceProjectAttachment: (
    projectId: string,
    attachmentId: string,
    attachment: T3WorkContextAttachment,
  ) => boolean;
  replaceKickoffAttachment: (
    projectId: string,
    ticketId: string,
    attachmentId: string,
    attachment: T3WorkContextAttachment,
  ) => boolean;
  replaceThreadAttachment: (
    threadId: string,
    attachmentId: string,
    attachment: T3WorkContextAttachment,
  ) => void;
  removeThreadAttachment: (threadId: string, attachmentId: string) => void;
  clearThreadAttachments: (threadId: string) => void;
  drainProject: (projectId: string) => PendingChatContextItem[];
  drainKickoff: (projectId: string, ticketId: string) => PendingKickoffContextItem[];
};
