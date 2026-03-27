import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface SecDeskLink {
  issueKey: string;
  url: string;
  createdAt: string;
}

interface SecDeskStore {
  /** Maps project ticketKey (e.g. "CE-15112") to its SECDESK ticket */
  linksByTicketKey: Record<string, SecDeskLink>;
  setLink: (ticketKey: string, link: SecDeskLink) => void;
  getLink: (ticketKey: string) => SecDeskLink | undefined;
  removeLink: (ticketKey: string) => void;
}

export const useSecDeskStore = create<SecDeskStore>()(
  persist(
    (set, get) => ({
      linksByTicketKey: {},
      setLink: (ticketKey, link) =>
        set((state) => ({
          linksByTicketKey: { ...state.linksByTicketKey, [ticketKey]: link },
        })),
      getLink: (ticketKey) => get().linksByTicketKey[ticketKey],
      removeLink: (ticketKey) =>
        set((state) => {
          const { [ticketKey]: _, ...rest } = state.linksByTicketKey;
          return { linksByTicketKey: rest };
        }),
    }),
    {
      name: "t3-secdesk-links",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ linksByTicketKey: state.linksByTicketKey }),
    },
  ),
);
