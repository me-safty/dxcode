import { create } from "zustand";

import { markRightPanelUsed } from "./rightPanelGesture";
import {
  closeWorkspaceSourceControlPanel,
  openWorkspaceSourceControlPanel,
  useWorkspaceFilePanelState,
} from "./workspaceFilePreview";

interface SourceControlPanelState {
  /**
   * Draft commit message, persisted across panel open/close so the user does
   * not lose what they typed when they hop between panels.
   */
  commitMessage: string;
  setCommitMessage: (commitMessage: string) => void;
}

const useSourceControlPanelStore = create<SourceControlPanelState>((set) => ({
  commitMessage: "",
  setCommitMessage: (commitMessage) => set({ commitMessage }),
}));

export function openSourceControlPanel(): void {
  markRightPanelUsed("source-control");
  openWorkspaceSourceControlPanel();
}

export function closeSourceControlPanel(): void {
  closeWorkspaceSourceControlPanel();
}

export function useSourceControlPanelState() {
  const filePanel = useWorkspaceFilePanelState();
  const commitMessage = useSourceControlPanelStore((state) => state.commitMessage);
  return {
    open: filePanel.open && filePanel.view === "source-control",
    commitMessage,
  };
}

export function useSetSourceControlCommitMessage() {
  return useSourceControlPanelStore((state) => state.setCommitMessage);
}
