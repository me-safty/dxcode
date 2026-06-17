import {
  type MessageId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import { create } from "zustand";
import type { ComposerFileAttachment, ComposerImageAttachment } from "./composerDraftStore";
import { newMessageId } from "~/lib/utils";
import type { TerminalContextDraft } from "./lib/terminalContext";

export interface QueuedMessage {
  readonly id: MessageId;
  readonly prompt: string;
  readonly images: ComposerImageAttachment[];
  readonly files: ComposerFileAttachment[];
  readonly terminalContexts: TerminalContextDraft[];
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly createdAt: string;
}

export interface MessageQueueState {
  readonly queueByThreadKey: Readonly<Record<string, QueuedMessage[]>>;
  readonly enqueue: (
    threadRef: ScopedThreadRef,
    message: Omit<QueuedMessage, "id" | "createdAt">,
  ) => QueuedMessage;
  readonly dequeue: (threadRef: ScopedThreadRef) => QueuedMessage | undefined;
  readonly remove: (threadRef: ScopedThreadRef, id: MessageId) => void;
  readonly clear: (threadRef: ScopedThreadRef) => void;
  readonly peek: (threadRef: ScopedThreadRef) => QueuedMessage | undefined;
  readonly getQueue: (threadRef: ScopedThreadRef) => readonly QueuedMessage[];
}

function threadKey(threadRef: ScopedThreadRef): string {
  return scopedThreadKey(threadRef);
}

function removeQueuedMessage(queue: QueuedMessage[], id: MessageId): QueuedMessage[] {
  const next = queue.filter((message) => message.id !== id);
  return next.length === queue.length ? queue : next;
}

function revokeQueuedMessagePreviewUrls(message: QueuedMessage): void {
  if (typeof URL === "undefined") {
    return;
  }
  for (const image of message.images) {
    if (image.previewUrl && image.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

export const useMessageQueue = create<MessageQueueState>((set, get) => ({
  queueByThreadKey: {},

  enqueue: (threadRef, message) => {
    const key = threadKey(threadRef);
    const queued: QueuedMessage = {
      ...message,
      id: newMessageId(),
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      queueByThreadKey: {
        ...state.queueByThreadKey,
        [key]: [...(state.queueByThreadKey[key] ?? []), queued],
      },
    }));
    return queued;
  },

  dequeue: (threadRef) => {
    const key = threadKey(threadRef);
    const queue = get().queueByThreadKey[key] ?? [];
    const [next, ...rest] = queue;
    if (!next) {
      return undefined;
    }
    set((state) => ({
      queueByThreadKey: {
        ...state.queueByThreadKey,
        [key]: rest,
      },
    }));
    return next;
  },

  remove: (threadRef, id) => {
    const key = threadKey(threadRef);
    set((state) => {
      const queue = state.queueByThreadKey[key];
      if (!queue) {
        return state;
      }
      const removed = queue.find((message) => message.id === id);
      const next = removeQueuedMessage(queue, id);
      if (next === queue) {
        return state;
      }
      if (removed) {
        revokeQueuedMessagePreviewUrls(removed);
      }
      return {
        queueByThreadKey: {
          ...state.queueByThreadKey,
          [key]: next,
        },
      };
    });
  },

  clear: (threadRef) => {
    const key = threadKey(threadRef);
    set((state) => {
      const queue = state.queueByThreadKey[key];
      if (!queue) {
        return state;
      }
      for (const message of queue) {
        revokeQueuedMessagePreviewUrls(message);
      }
      const next = { ...state.queueByThreadKey };
      delete next[key];
      return { queueByThreadKey: next };
    });
  },

  peek: (threadRef) => {
    const key = threadKey(threadRef);
    const queue = get().queueByThreadKey[key];
    return queue?.[0];
  },

  getQueue: (threadRef) => {
    const key = threadKey(threadRef);
    return get().queueByThreadKey[key] ?? [];
  },
}));
