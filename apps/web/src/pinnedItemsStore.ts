import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

/**
 * Items the user has pinned to the sidebar (above Settings). Persisted to
 * localStorage so pins survive app restarts.
 */

export interface PinnedChat {
  id: string;
  kind: "chat";
  environmentId: EnvironmentId;
  threadId: ThreadId;
  title: string;
}

export interface PinnedEntry {
  id: string;
  kind: "file" | "directory";
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Absolute workspace root, needed to re-open the project editor. */
  cwd: string;
  /** Path relative to the workspace root. */
  path: string;
  name: string;
}

export type PinnedItem = PinnedChat | PinnedEntry;

export function chatPinId(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `chat:${environmentId}:${threadId}`;
}

export function entryPinId(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  path: string,
): string {
  return `entry:${environmentId}:${projectId}:${path}`;
}

interface PinnedItemsState {
  items: PinnedItem[];
  pinChat: (input: Omit<PinnedChat, "id" | "kind">) => void;
  pinEntry: (input: Omit<PinnedEntry, "id" | "kind"> & { kind: "file" | "directory" }) => void;
  unpin: (id: string) => void;
  reorder: (activeId: string, overId: string) => void;
  isPinned: (id: string) => boolean;
}

export const usePinnedItemsStore = create<PinnedItemsState>()(
  persist(
    (set, get) => ({
      items: [],
      pinChat: (input) => {
        const id = chatPinId(input.environmentId, input.threadId);
        if (get().items.some((item) => item.id === id)) {
          return;
        }
        set((state) => ({ items: [...state.items, { id, kind: "chat", ...input }] }));
      },
      pinEntry: (input) => {
        const id = entryPinId(input.environmentId, input.projectId, input.path);
        if (get().items.some((item) => item.id === id)) {
          return;
        }
        const { kind, ...rest } = input;
        set((state) => ({ items: [...state.items, { id, kind, ...rest }] }));
      },
      unpin: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      reorder: (activeId, overId) =>
        set((state) => {
          const from = state.items.findIndex((item) => item.id === activeId);
          const to = state.items.findIndex((item) => item.id === overId);
          if (from === -1 || to === -1 || from === to) {
            return state;
          }
          const items = state.items.slice();
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved!);
          return { items };
        }),
      isPinned: (id) => get().items.some((item) => item.id === id),
    }),
    { name: "t3code:pinned:v1" },
  ),
);
