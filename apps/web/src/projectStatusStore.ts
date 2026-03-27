import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectId } from "@t3tools/contracts";

interface ProjectStatusStore {
  waitingProjectIds: Set<ProjectId>;
  toggleWaiting: (projectId: ProjectId) => void;
  isWaiting: (projectId: ProjectId) => boolean;
}

export const useProjectStatusStore = create<ProjectStatusStore>()(
  persist(
    (set, get) => ({
      waitingProjectIds: new Set<ProjectId>(),
      toggleWaiting: (projectId) =>
        set((state) => {
          const next = new Set(state.waitingProjectIds);
          if (next.has(projectId)) {
            next.delete(projectId);
          } else {
            next.add(projectId);
          }
          return { waitingProjectIds: next };
        }),
      isWaiting: (projectId) => get().waitingProjectIds.has(projectId),
    }),
    {
      name: "t3-project-status",
      storage: {
        getItem: (name) => {
          const raw = localStorage.getItem(name);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (parsed?.state?.waitingProjectIds) {
            parsed.state.waitingProjectIds = new Set(parsed.state.waitingProjectIds);
          }
          return parsed;
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              waitingProjectIds: Array.from(value.state.waitingProjectIds),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
