"use client";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type FilesystemBrowseResult,
  type ProjectId,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { readEnvironmentApi } from "../environmentApi";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import {
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  findProjectByPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { isTerminalFocused } from "../lib/terminalFocus";
import { getLatestThreadForProject } from "../lib/threadSort";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import {
  ADDON_ICON_CLASS,
  buildBrowseGroups,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterBrowseEntries,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
} from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { ProjectFavicon } from "./ProjectFavicon";
import { useServerKeybindings } from "../rpc/serverState";
import { resolveShortcutCommand } from "../keybindings";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandPanel,
} from "./ui/command";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { toastManager } from "./ui/toast";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const BROWSE_STALE_TIME_MS = 30_000;

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const toggleOpen = useCommandPaletteStore((store) => store.toggleOpen);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });
      if (command !== "commandPalette.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, terminalOpen, toggleOpen]);

  return (
    <ComposerHandleContext.Provider value={composerHandleRef}>
      <CommandDialog open={open} onOpenChange={setOpen}>
        {children}
        <CommandPaletteDialog />
      </CommandDialog>
    </ComposerHandleContext.Provider>
  );
}

function CommandPaletteDialog() {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);

  useEffect(() => {
    return () => {
      setOpen(false);
    };
  }, [setOpen]);

  if (!open) {
    return null;
  }

  return <OpenCommandPaletteDialog />;
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const composerHandleRef = useComposerHandleContext();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const isBrowsing = isFilesystemBrowseQuery(query);
  const queryClient = useQueryClient();
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const settings = useSettings();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const keybindings = useServerKeybindings();
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const projectCwdById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.cwd])),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwd === null;
  const browseDirectoryPath = isBrowsing ? getBrowseDirectoryPath(query) : "";
  const browseFilterQuery =
    isBrowsing && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";

  const fetchBrowseResult = useCallback(
    async (partialPath: string): Promise<FilesystemBrowseResult | null> => {
      if (!primaryEnvironmentId) return null;
      const api = readEnvironmentApi(primaryEnvironmentId);
      if (!api) return null;
      return api.filesystem.browse({
        partialPath,
        ...(currentProjectCwd ? { cwd: currentProjectCwd } : {}),
      });
    },
    [currentProjectCwd, primaryEnvironmentId],
  );

  const { data: browseResult } = useQuery({
    queryKey: ["filesystemBrowse", browseDirectoryPath, currentProjectCwd],
    queryFn: () => fetchBrowseResult(browseDirectoryPath),
    staleTime: BROWSE_STALE_TIME_MS,
    enabled: isBrowsing && browseDirectoryPath.length > 0 && !relativePathNeedsActiveProject,
  });
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const {
    filteredEntries: filteredBrowseEntries,
    highlightedEntry: highlightedBrowseEntry,
    exactEntry: exactBrowseEntry,
  } = useMemo(
    () => filterBrowseEntries({ browseEntries, browseFilterQuery, highlightedItemValue }),
    [browseEntries, browseFilterQuery, highlightedItemValue],
  );

  const prefetchBrowsePath = useCallback(
    (partialPath: string) => {
      void queryClient.prefetchQuery({
        queryKey: ["filesystemBrowse", partialPath, currentProjectCwd],
        queryFn: () => fetchBrowseResult(partialPath),
        staleTime: BROWSE_STALE_TIME_MS,
      });
    },
    [currentProjectCwd, fetchBrowseResult, queryClient],
  );

  // Prefetch the parent and the most likely next child so browse navigation
  // stays warm without scanning every child directory in large trees.
  useEffect(() => {
    if (!isBrowsing || filteredBrowseEntries.length === 0) return;

    if (canNavigateUp(query)) {
      prefetchBrowsePath(getBrowseParentPath(query)!);
    }

    const nextChild = highlightedBrowseEntry ?? exactBrowseEntry;
    if (nextChild) {
      prefetchBrowsePath(appendBrowsePathSegment(query, nextChild.name));
    }
  }, [
    exactBrowseEntry,
    filteredBrowseEntries.length,
    highlightedBrowseEntry,
    isBrowsing,
    prefetchBrowsePath,
    query,
  ]);

  const openProjectFromSearch = useMemo(
    () => async (project: (typeof projects)[number]) => {
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === project.environmentId),
        project.id,
        settings.sidebarThreadSortOrder,
      );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        envMode: settings.defaultThreadEnvMode,
      });
    },
    [
      handleNewThread,
      navigate,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "project",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className={ITEM_ICON_CLASS}
          />
        ),
        runProject: openProjectFromSearch,
      }),
    [openProjectFromSearch, projects],
  );

  const projectThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "new-thread-in",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className={ITEM_ICON_CLASS}
          />
        ),
        runProject: async (project) => {
          await startNewThreadInProjectFromContext(
            {
              activeDraftThread,
              activeThread,
              defaultProjectRef,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
            },
            scopeProjectRef(project.environmentId, project.id),
          );
        },
      }),
    [
      activeDraftThread,
      activeThread,
      defaultProjectRef,
      handleNewThread,
      projects,
      settings.defaultThreadEnvMode,
    ],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: settings.sidebarThreadSortOrder,
        icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
        runThread: async (thread) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
        },
      }),
    [activeThreadId, navigate, projectTitleById, settings.sidebarThreadSortOrder, threads],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  function pushView(item: CommandPaletteSubmenuItem): void {
    setViewStack((previousViews) => [
      ...previousViews,
      {
        addonIcon: item.addonIcon,
        groups: item.groups,
        ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
      },
    ]);
    setHighlightedItemValue(null);
    setQuery(item.initialQuery ?? "");
  }

  function popView(): void {
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle = currentProjectId
      ? (projectTitleById.get(currentProjectId) ?? null)
      : null;

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            New thread in <span className="font-semibold">{activeProjectTitle}</span>
          </>
        ),
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread,
            defaultProjectRef,
            defaultThreadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }

  actionItems.push({
    kind: "submenu",
    value: "action:add-project",
    searchTerms: ["add project", "folder", "directory", "browse"],
    title: "Add project",
    icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
    groups: [],
    initialQuery: "~/",
  });

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const activeGroups = currentView ? currentView.groups : rootGroups;

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    threadSearchItems: allThreadItems,
  });

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      if (!primaryEnvironmentId) return;
      const api = readEnvironmentApi(primaryEnvironmentId);
      if (!api) return;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), navigator.platform)) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: "Windows-style paths are only supported on Windows.",
        });
        return;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !currentProjectCwd) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: "Relative paths require an active project.",
        });
        return;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, currentProjectCwd);
      if (cwd.length === 0) return;

      const existing = findProjectByPath(projects, cwd);
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          settings.sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          await handleNewThread(scopeProjectRef(existing.environmentId, existing.id), {
            envMode: settings.defaultThreadEnvMode,
          }).catch(() => undefined);
        }
        setOpen(false);
        return;
      }

      try {
        const projectId = newProjectId();
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt: new Date().toISOString(),
        });
        await handleNewThread(scopeProjectRef(primaryEnvironmentId, projectId), {
          envMode: settings.defaultThreadEnvMode,
        }).catch(() => undefined);
        setOpen(false);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [
      currentProjectCwd,
      handleNewThread,
      navigate,
      primaryEnvironmentId,
      projects,
      setOpen,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  function browseTo(name: string): void {
    const nextQuery = appendBrowsePathSegment(query, name);
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setBrowseGeneration((generation) => generation + 1);
  }

  function browseUp(): void {
    const parentPath = getBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }

    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }

  // Resolve the add-project path from browse data when available. When the
  // query has a trailing separator (e.g. "~/projects/foo/"), parentPath is the
  // directory itself. Otherwise the user typed a partial leaf name, so we need
  // the exact browse entry's fullPath or fall back to the raw query.
  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp =
    isBrowsing && !relativePathNeedsActiveProject && canNavigateUp(browseDirectoryPath);

  const browseGroups = buildBrowseGroups({
    browseEntries: filteredBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp,
    browseTo,
  });

  let displayedGroups = filteredGroups;
  if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }

  const inputPlaceholder = getCommandPaletteInputPlaceholder(paletteMode);
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (
      isBrowsing &&
      event.key === "Enter" &&
      !highlightedItemValue?.startsWith("browse:") &&
      !relativePathNeedsActiveProject
    ) {
      event.preventDefault();
      void handleAddProject(resolvedAddProjectPath);
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.kind === "submenu") {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to run command",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  }

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden p-0"
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
    >
      <Command
        key={`${viewStack.length}-${browseGeneration}-${isBrowsing}`}
        aria-label="Command palette"
        autoHighlight={isBrowsing ? false : "always"}
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
            className={isBrowsing ? "pe-16" : undefined}
            placeholder={inputPlaceholder}
            wrapperClassName={
              isSubmenu
                ? "[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto [&_[data-slot=autocomplete-start-addon]]:cursor-pointer"
                : undefined
            }
            {...(isSubmenu
              ? {
                  startAddon: (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center"
                      aria-label="Back"
                      onClick={popView}
                    >
                      <ArrowLeftIcon />
                    </button>
                  ),
                }
              : isBrowsing && !isSubmenu
                ? {
                    startAddon: <FolderPlusIcon />,
                  }
                : {})}
            onKeyDown={handleKeyDown}
          />
          {isBrowsing ? (
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className="absolute end-2.5 top-1/2 -translate-y-1/2"
              disabled={relativePathNeedsActiveProject}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (relativePathNeedsActiveProject) {
                  return;
                }
                void handleAddProject(resolvedAddProjectPath);
              }}
            >
              Add
            </Button>
          ) : null}
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            groups={displayedGroups}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
            {...(relativePathNeedsActiveProject
              ? { emptyStateMessage: "Relative paths require an active project." }
              : {})}
          />
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span className={cn("text-muted-foreground/80")}>Navigate</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Enter</Kbd>
              <span className={cn("text-muted-foreground/80")}>Select</span>
            </KbdGroup>
            {isSubmenu ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span className={cn("text-muted-foreground/80")}>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className={cn("text-muted-foreground/80")}>Close</span>
            </KbdGroup>
          </div>
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}
