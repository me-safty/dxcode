import { create } from "zustand";

import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { readEnvironmentApi } from "./environmentApi";

/**
 * Client-side state for the in-app IDE.
 *
 * Owns which project is currently open, the file-tree expansion state, and the
 * set of open editor tabs (including their unsaved buffers and per-tab markdown
 * view mode). File contents are loaded/saved through the environment RPC API
 * (`projects.readFile` / `projects.writeFile`).
 */

export type IdeMarkdownView = "preview" | "source";

export type IdeTabStatus = "loading" | "ready" | "error";

export interface IdeTab {
  /** Path relative to the project root, POSIX separators. Stable tab key. */
  path: string;
  /** Base file name, for the tab label. */
  name: string;
  status: IdeTabStatus;
  /** True when the file is binary and cannot be edited as text. */
  binary: boolean;
  /** Contents as last loaded from / saved to disk. */
  savedContent: string;
  /** Current editor buffer. Differs from savedContent when dirty. */
  buffer: string;
  byteSize: number;
  /** Markdown tabs only: whether to show the WYSIWYG preview or raw source. */
  markdownView: IdeMarkdownView;
  saving: boolean;
  errorMessage?: string | undefined;
}

export interface IdeTarget {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Absolute workspace root of the project. */
  cwd: string;
  name: string;
}

interface IdeState {
  target: IdeTarget | null;
  /** Directory relative paths ("" is the root) -> expanded. */
  expandedDirs: Record<string, boolean>;
  tabs: IdeTab[];
  activeTabPath: string | null;

  openProject: (target: IdeTarget) => void;
  closeProject: () => void;

  toggleDir: (path: string) => void;
  setDirExpanded: (path: string, expanded: boolean) => void;

  /** Open (or focus) a file tab and lazily load its contents. */
  openFile: (path: string, name: string) => void;
  reloadFile: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;

  updateBuffer: (path: string, buffer: string) => void;
  setMarkdownView: (path: string, view: IdeMarkdownView) => void;
  /** Persist the active buffer to disk. */
  saveTab: (path: string) => Promise<void>;
}

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"];

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isTabDirty(tab: IdeTab): boolean {
  return tab.status === "ready" && !tab.binary && tab.buffer !== tab.savedContent;
}

function replaceTab(tabs: IdeTab[], path: string, update: (tab: IdeTab) => IdeTab): IdeTab[] {
  return tabs.map((tab) => (tab.path === path ? update(tab) : tab));
}

export const useIdeStore = create<IdeState>((set, get) => ({
  target: null,
  expandedDirs: { "": true },
  tabs: [],
  activeTabPath: null,

  openProject: (target) => {
    const current = get().target;
    if (
      current &&
      current.projectId === target.projectId &&
      current.environmentId === target.environmentId
    ) {
      // Re-opening the same project keeps tabs and tree state intact.
      return;
    }
    set({ target, expandedDirs: { "": true }, tabs: [], activeTabPath: null });
  },

  closeProject: () => set({ target: null, tabs: [], activeTabPath: null }),

  toggleDir: (path) =>
    set((state) => ({
      expandedDirs: { ...state.expandedDirs, [path]: !state.expandedDirs[path] },
    })),

  setDirExpanded: (path, expanded) =>
    set((state) => ({ expandedDirs: { ...state.expandedDirs, [path]: expanded } })),

  openFile: (path, name) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activeTabPath: path });
      return;
    }
    const tab: IdeTab = {
      path,
      name,
      status: "loading",
      binary: false,
      savedContent: "",
      buffer: "",
      byteSize: 0,
      markdownView: isMarkdownPath(path) ? "preview" : "source",
      saving: false,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabPath: path }));
    get().reloadFile(path);
  },

  reloadFile: (path) => {
    const { target } = get();
    if (!target) {
      return;
    }
    const api = readEnvironmentApi(target.environmentId);
    if (!api) {
      set((state) => ({
        tabs: replaceTab(state.tabs, path, (tab) => ({
          ...tab,
          status: "error",
          errorMessage: "Project connection is not available.",
        })),
      }));
      return;
    }
    set((state) => ({
      tabs: replaceTab(state.tabs, path, (tab) => ({
        ...tab,
        status: "loading",
        errorMessage: undefined,
      })),
    }));
    api.projects
      .readFile({ cwd: target.cwd, relativePath: path })
      .then((result) => {
        set((state) => ({
          tabs: replaceTab(state.tabs, path, (tab) => ({
            ...tab,
            status: "ready",
            binary: result.binary,
            savedContent: result.contents,
            buffer: result.contents,
            byteSize: result.byteSize,
            errorMessage: undefined,
          })),
        }));
      })
      .catch((error: unknown) => {
        set((state) => ({
          tabs: replaceTab(state.tabs, path, (tab) => ({
            ...tab,
            status: "error",
            errorMessage: error instanceof Error ? error.message : "Failed to read file.",
          })),
        }));
      });
  },

  closeTab: (path) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.path !== path);
      let activeTabPath = state.activeTabPath;
      if (activeTabPath === path) {
        const closedIndex = state.tabs.findIndex((tab) => tab.path === path);
        const next = tabs[closedIndex] ?? tabs[closedIndex - 1] ?? tabs[tabs.length - 1];
        activeTabPath = next?.path ?? null;
      }
      return { tabs, activeTabPath };
    }),

  setActiveTab: (path) => set({ activeTabPath: path }),

  updateBuffer: (path, buffer) =>
    set((state) => ({
      tabs: replaceTab(state.tabs, path, (tab) =>
        tab.buffer === buffer ? tab : { ...tab, buffer },
      ),
    })),

  setMarkdownView: (path, view) =>
    set((state) => ({
      tabs: replaceTab(state.tabs, path, (tab) => ({ ...tab, markdownView: view })),
    })),

  saveTab: async (path) => {
    const { target, tabs } = get();
    const tab = tabs.find((entry) => entry.path === path);
    if (!target || !tab || tab.status !== "ready" || tab.binary || !isTabDirty(tab)) {
      return;
    }
    const api = readEnvironmentApi(target.environmentId);
    if (!api) {
      return;
    }
    const contents = tab.buffer;
    set((state) => ({
      tabs: replaceTab(state.tabs, path, (entry) => ({ ...entry, saving: true })),
    }));
    try {
      await api.projects.writeFile({ cwd: target.cwd, relativePath: path, contents });
      set((state) => ({
        tabs: replaceTab(state.tabs, path, (entry) => ({
          ...entry,
          saving: false,
          // Only the persisted slice is now "clean"; keep newer keystrokes.
          savedContent: contents,
        })),
      }));
    } catch (error: unknown) {
      set((state) => ({
        tabs: replaceTab(state.tabs, path, (entry) => ({
          ...entry,
          saving: false,
          errorMessage: error instanceof Error ? error.message : "Failed to save file.",
        })),
      }));
    }
  },
}));

export function selectActiveTab(state: IdeState): IdeTab | null {
  if (!state.activeTabPath) {
    return null;
  }
  return state.tabs.find((tab) => tab.path === state.activeTabPath) ?? null;
}
