import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { PersistedComposerImageAttachment } from "./composerDraftStore";
import type { ChatComposerSendContext } from "./components/chat/ChatComposer";
import { readFileAsDataUrl } from "./components/ChatView.logic";
import { createMemoryStorage, createResilientStorage } from "./lib/storage";

export const RUNNING_MESSAGE_QUEUE_STORAGE_KEY = "t3code:running-message-queue:v1";

export type QueuedComposerSubmission = {
  readonly id: string;
  readonly threadKey: string;
  readonly sendContext: ChatComposerSendContext;
  readonly delivery: {
    readonly messageId: string;
    readonly observedRunning: boolean;
  } | null;
};

type PersistedQueuedComposerSubmission = Omit<QueuedComposerSubmission, "sendContext"> & {
  readonly sendContext: Omit<ChatComposerSendContext, "images"> & {
    readonly images: ReadonlyArray<PersistedComposerImageAttachment>;
  };
};

type RunningMessageQueueStore = {
  readonly submissions: QueuedComposerSubmission[];
  readonly setSubmissions: (submissions: QueuedComposerSubmission[]) => void;
};

function hydrateImage(attachment: PersistedComposerImageAttachment) {
  if (typeof File === "undefined") return null;
  const commaIndex = attachment.dataUrl.indexOf(",");
  if (commaIndex < 0) return null;
  try {
    const header = attachment.dataUrl.slice(0, commaIndex);
    const payload = attachment.dataUrl.slice(commaIndex + 1);
    const bytes = header.includes(";base64")
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    const file = new File([bytes], attachment.name, { type: attachment.mimeType });
    return {
      type: "image" as const,
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      previewUrl: attachment.dataUrl,
      file,
    };
  } catch {
    return null;
  }
}

function normalizePersistedSubmissions(value: unknown): QueuedComposerSubmission[] {
  if (!value || typeof value !== "object") return [];
  const submissions = (value as { submissions?: unknown }).submissions;
  if (!Array.isArray(submissions)) return [];
  return submissions.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<PersistedQueuedComposerSubmission>;
    const context = candidate.sendContext;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.threadKey !== "string" ||
      !context ||
      typeof context.prompt !== "string" ||
      !Array.isArray(context.images)
    ) {
      return [];
    }
    const images = context.images.flatMap((image) => {
      const hydrated = hydrateImage(image);
      return hydrated ? [hydrated] : [];
    });
    return [
      {
        id: candidate.id,
        threadKey: candidate.threadKey,
        sendContext: { ...context, images } as ChatComposerSendContext,
        delivery:
          candidate.delivery &&
          typeof candidate.delivery.messageId === "string" &&
          typeof candidate.delivery.observedRunning === "boolean"
            ? candidate.delivery
            : null,
      },
    ];
  });
}

export async function prepareQueuedComposerSubmission(input: {
  readonly id: string;
  readonly threadKey: string;
  readonly sendContext: ChatComposerSendContext;
}): Promise<QueuedComposerSubmission> {
  const images = await Promise.all(
    input.sendContext.images.map(async (image) => ({
      ...image,
      previewUrl: await readFileAsDataUrl(image.file),
    })),
  );
  return {
    id: input.id,
    threadKey: input.threadKey,
    sendContext: { ...input.sendContext, images },
    delivery: null,
  };
}

export const useRunningMessageQueueStore = create<RunningMessageQueueStore>()(
  persist(
    (set) => ({
      submissions: [],
      setSubmissions: (submissions) => set({ submissions }),
    }),
    {
      name: RUNNING_MESSAGE_QUEUE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        createResilientStorage(
          typeof localStorage === "undefined" ? createMemoryStorage() : localStorage,
        ),
      ),
      partialize: (state) => ({
        submissions: state.submissions.map(
          (submission): PersistedQueuedComposerSubmission => ({
            ...submission,
            sendContext: {
              ...submission.sendContext,
              images: submission.sendContext.images.map((image) => ({
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl: image.previewUrl,
              })),
            },
          }),
        ),
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        submissions: normalizePersistedSubmissions(persistedState),
      }),
    },
  ),
);
