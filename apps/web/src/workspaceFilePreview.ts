import type { EnvironmentId, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { DiffRouteSource } from "./diffRouteSearch";
import { openInPreferredEditor } from "./editorPreferences";
import { readLocalApi } from "./localApi";
import { openRightPanel } from "./rightPanelGesture";
import { splitPathAndPosition } from "./terminal-links";

export interface WorkspaceFilePreviewDiffReturnTarget {
  kind: "diff";
  diffSource?: DiffRouteSource;
  diffTurnId?: TurnId;
  diffFilePath?: string;
}

export interface WorkspaceFilePreviewExplorerReturnTarget {
  kind: "explorer";
}

export type WorkspaceFilePreviewReturnTarget =
  | WorkspaceFilePreviewDiffReturnTarget
  | WorkspaceFilePreviewExplorerReturnTarget;

export interface WorkspaceFilePreviewTarget {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  displayPath: string;
  line?: number;
  column?: number;
}

export interface WorkspaceFileExplorerContext {
  environmentId: EnvironmentId;
  cwd: string;
  projectName?: string;
}

export interface WorkspaceFilePreviewReturnPreview {
  target: WorkspaceFilePreviewTarget;
  returnTarget: WorkspaceFilePreviewReturnTarget | null;
}

export type WorkspaceFilePanelView = "explorer" | "preview";

interface WorkspaceFilePreviewState {
  open: boolean;
  view: WorkspaceFilePanelView;
  target: WorkspaceFilePreviewTarget | null;
  explorerContext: WorkspaceFileExplorerContext | null;
  explorerReturnPreview: WorkspaceFilePreviewReturnPreview | null;
  returnTarget: WorkspaceFilePreviewReturnTarget | null;
  openPreview: (
    target: WorkspaceFilePreviewTarget,
    options?: { returnTarget?: WorkspaceFilePreviewReturnTarget | null },
  ) => void;
  openExplorer: (
    context: WorkspaceFileExplorerContext,
    options?: { returnToPreview?: WorkspaceFilePreviewReturnPreview | null },
  ) => void;
  reopenPanel: () => void;
  reopenPreview: () => void;
  returnExplorerToPreview: () => void;
  returnPreviewToExplorer: (context: WorkspaceFileExplorerContext) => void;
  closePreview: () => void;
}

function deriveExplorerContextFromTarget(
  target: WorkspaceFilePreviewTarget,
  existingContext: WorkspaceFileExplorerContext | null,
): WorkspaceFileExplorerContext {
  if (
    existingContext &&
    existingContext.environmentId === target.environmentId &&
    existingContext.cwd === target.cwd
  ) {
    return existingContext;
  }
  return {
    environmentId: target.environmentId,
    cwd: target.cwd,
  };
}

const useWorkspaceFilePreviewStore = create<WorkspaceFilePreviewState>((set) => ({
  open: false,
  view: "preview",
  target: null,
  explorerContext: null,
  explorerReturnPreview: null,
  returnTarget: null,
  openPreview: (target, options) =>
    set((state) => ({
      open: true,
      view: "preview",
      target,
      explorerContext: deriveExplorerContextFromTarget(target, state.explorerContext),
      explorerReturnPreview: null,
      returnTarget: options?.returnTarget ?? null,
    })),
  openExplorer: (context, options) =>
    set({
      open: true,
      view: "explorer",
      explorerContext: context,
      explorerReturnPreview: options?.returnToPreview ?? null,
      returnTarget: null,
    }),
  reopenPanel: () =>
    set((state) => {
      if (!state.target && !state.explorerContext) {
        return state;
      }
      if (state.view === "explorer" && state.explorerContext) {
        return { ...state, open: true };
      }
      if (state.target) {
        return { ...state, open: true, view: "preview" };
      }
      return { ...state, open: true, view: "explorer" };
    }),
  reopenPreview: () =>
    set((state) =>
      state.target && (!state.open || state.view !== "preview")
        ? { ...state, open: true, view: "preview", explorerReturnPreview: null }
        : state,
    ),
  returnExplorerToPreview: () =>
    set((state) => {
      if (!state.explorerReturnPreview) {
        return state;
      }
      return {
        ...state,
        open: true,
        view: "preview",
        target: state.explorerReturnPreview.target,
        explorerContext: deriveExplorerContextFromTarget(
          state.explorerReturnPreview.target,
          state.explorerContext,
        ),
        returnTarget: state.explorerReturnPreview.returnTarget,
        explorerReturnPreview: null,
      };
    }),
  returnPreviewToExplorer: (context) =>
    set((state) => ({
      ...state,
      open: true,
      view: "explorer",
      explorerContext: context,
      explorerReturnPreview: null,
      returnTarget: null,
    })),
  closePreview: () =>
    set((state) =>
      state.open || state.returnTarget || state.explorerReturnPreview
        ? { ...state, open: false, returnTarget: null, explorerReturnPreview: null }
        : state,
    ),
}));

function normalizePathSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function stripRelativePrefix(value: string): string {
  return normalizePathSeparators(value)
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveWorkspaceFilePreviewTarget(input: {
  environmentId: EnvironmentId;
  cwd: string;
  targetPath: string;
  displayPath?: string;
}): WorkspaceFilePreviewTarget | null {
  const { path, line, column } = splitPathAndPosition(input.targetPath);
  const normalizedPath = normalizePathSeparators(path);
  const normalizedCwd = normalizePathSeparators(trimTrailingSeparators(input.cwd));

  let relativePath: string | null = null;
  if (isAbsolutePath(path)) {
    const comparePath = normalizedPath.toLowerCase();
    const compareCwd = normalizedCwd.toLowerCase();
    const cwdWithSeparator = `${compareCwd}/`;
    if (comparePath.startsWith(cwdWithSeparator)) {
      relativePath = normalizedPath.slice(normalizedCwd.length + 1);
    }
  } else {
    relativePath = stripRelativePrefix(path);
  }

  if (
    !relativePath ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    return null;
  }
  const lineNumber = parseOptionalPositiveInt(line);
  const columnNumber = parseOptionalPositiveInt(column);

  const target: WorkspaceFilePreviewTarget = {
    environmentId: input.environmentId,
    cwd: input.cwd,
    relativePath,
    displayPath: input.displayPath ?? relativePath,
  };
  if (lineNumber !== undefined) {
    target.line = lineNumber;
  }
  if (columnNumber !== undefined) {
    target.column = columnNumber;
  }
  return target;
}

function isNoAvailableEditorsError(error: unknown): boolean {
  return error instanceof Error && error.message === "No available editors found.";
}

export function openWorkspaceFilePreview(
  target: WorkspaceFilePreviewTarget,
  options?: { returnTarget?: WorkspaceFilePreviewReturnTarget | null },
): void {
  useWorkspaceFilePreviewStore.getState().openPreview(target, options);
  openRightPanel("file");
}

export function openWorkspaceFileExplorer(
  context: WorkspaceFileExplorerContext,
  options?: { returnToPreview?: WorkspaceFilePreviewReturnPreview | null },
): void {
  useWorkspaceFilePreviewStore.getState().openExplorer(context, options);
  openRightPanel("file");
}

export async function openPathInPreferredEditorOrFilePreview(input: {
  targetPath: string;
  environmentId?: EnvironmentId | undefined;
  cwd?: string | undefined;
  displayPath?: string | undefined;
  returnTarget?: WorkspaceFilePreviewReturnTarget | null | undefined;
}): Promise<"editor" | "preview"> {
  const api = readLocalApi();
  if (api) {
    try {
      await openInPreferredEditor(api, input.targetPath);
      return "editor";
    } catch (error) {
      if (!isNoAvailableEditorsError(error)) {
        throw error;
      }
    }
  }

  if (input.environmentId && input.cwd) {
    const target = resolveWorkspaceFilePreviewTarget({
      environmentId: input.environmentId,
      cwd: input.cwd,
      targetPath: input.targetPath,
      ...(input.displayPath ? { displayPath: input.displayPath } : {}),
    });
    if (target) {
      openWorkspaceFilePreview(target, { returnTarget: input.returnTarget ?? null });
      return "preview";
    }
  }

  throw new Error(api ? "No available editors found." : "Local API not found");
}

export function useWorkspaceFilePreviewState() {
  return useWorkspaceFilePreviewStore(
    useShallow((state) => ({
      open: state.open,
      view: state.view,
      target: state.target,
      explorerContext: state.explorerContext,
      explorerReturnPreview: state.explorerReturnPreview,
      returnTarget: state.returnTarget,
    })),
  );
}

export const useWorkspaceFilePanelState = useWorkspaceFilePreviewState;

export function closeWorkspaceFilePreview(): void {
  useWorkspaceFilePreviewStore.getState().closePreview();
}

export function reopenWorkspaceFilePreview(): void {
  useWorkspaceFilePreviewStore.getState().reopenPreview();
}

export function reopenWorkspaceFilePanel(): void {
  useWorkspaceFilePreviewStore.getState().reopenPanel();
}

export function __readWorkspaceFilePanelStateForTests() {
  const { open, view, target, explorerContext, explorerReturnPreview, returnTarget } =
    useWorkspaceFilePreviewStore.getState();
  return { open, view, target, explorerContext, explorerReturnPreview, returnTarget };
}

export function __resetWorkspaceFilePanelStateForTests(): void {
  useWorkspaceFilePreviewStore.setState({
    open: false,
    view: "preview",
    target: null,
    explorerContext: null,
    explorerReturnPreview: null,
    returnTarget: null,
  });
}

export function returnWorkspaceFileExplorerToPreview(): void {
  useWorkspaceFilePreviewStore.getState().returnExplorerToPreview();
}

export function returnWorkspaceFilePreviewToExplorer(context: WorkspaceFileExplorerContext): void {
  useWorkspaceFilePreviewStore.getState().returnPreviewToExplorer(context);
}
