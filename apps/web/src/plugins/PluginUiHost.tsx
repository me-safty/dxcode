import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  PluginCommandRegistration,
  PluginComponent,
  PluginProjectActionRenderProps,
  PluginRouteComponentProps,
  PluginSettingsComponentProps,
  PluginSidebarSectionRenderProps,
  PluginUiContext,
  PluginWebDefinition,
  PluginWebRpc,
} from "@t3tools/plugin-sdk-web";
import type { PluginId, PluginInfo } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";

import { pluginListAtom, pluginRpc } from "../state/plugins";
import { whenPluginHostReady } from "./hostSingletons";

export interface RegisteredPluginRoute {
  readonly pluginId: PluginId;
  readonly path: string;
  readonly component: PluginComponent<PluginRouteComponentProps>;
}

export interface RegisteredPluginSidebarSection {
  readonly pluginId: PluginId;
  readonly id: string;
  readonly title: string;
  readonly render: (props: PluginSidebarSectionRenderProps) => unknown;
}

export interface RegisteredPluginSettingsPage {
  readonly pluginId: PluginId;
  readonly id: string;
  readonly title: string;
  readonly component: PluginComponent<PluginSettingsComponentProps>;
}

export interface RegisteredPluginProjectAction {
  readonly pluginId: PluginId;
  readonly id: string;
  readonly render: (props: PluginProjectActionRenderProps) => unknown;
}

export interface RegisteredPluginCommand extends PluginCommandRegistration {
  readonly pluginId: PluginId;
  readonly context: PluginUiContext;
}

export interface PluginUiRegistrySnapshot {
  readonly routes: ReadonlyArray<RegisteredPluginRoute>;
  readonly sidebarSections: ReadonlyArray<RegisteredPluginSidebarSection>;
  readonly settingsPages: ReadonlyArray<RegisteredPluginSettingsPage>;
  readonly commands: ReadonlyArray<RegisteredPluginCommand>;
  readonly projectActions: ReadonlyArray<RegisteredPluginProjectAction>;
  readonly failures: Readonly<Record<string, string>>;
}

interface LoadedPlugin {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly routes: ReadonlyArray<RegisteredPluginRoute>;
  readonly sidebarSections: ReadonlyArray<RegisteredPluginSidebarSection>;
  readonly settingsPages: ReadonlyArray<RegisteredPluginSettingsPage>;
  readonly commands: ReadonlyArray<RegisteredPluginCommand>;
  readonly projectActions: ReadonlyArray<RegisteredPluginProjectAction>;
  readonly failure: string | null;
}

export interface PluginUiHostState {
  readonly loaded: Map<string, LoadedPlugin>;
}

export const EMPTY_PLUGIN_UI_REGISTRY_SNAPSHOT: PluginUiRegistrySnapshot = Object.freeze({
  routes: Object.freeze([]),
  sidebarSections: Object.freeze([]),
  settingsPages: Object.freeze([]),
  commands: Object.freeze([]),
  projectActions: Object.freeze([]),
  failures: Object.freeze({}),
});

export const pluginUiRegistryAtom = Atom.make<PluginUiRegistrySnapshot>(
  EMPTY_PLUGIN_UI_REGISTRY_SNAPSHOT,
).pipe(Atom.keepAlive, Atom.withLabel("web-plugins:ui-registry"));

export function createPluginUiHostState(): PluginUiHostState {
  return { loaded: new Map() };
}

function normalizePluginPath(path: string): string {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

function formatPluginError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error);
}

function snapshotFromState(state: PluginUiHostState): PluginUiRegistrySnapshot {
  const routes: Array<RegisteredPluginRoute> = [];
  const sidebarSections: Array<RegisteredPluginSidebarSection> = [];
  const settingsPages: Array<RegisteredPluginSettingsPage> = [];
  const commands: Array<RegisteredPluginCommand> = [];
  const projectActions: Array<RegisteredPluginProjectAction> = [];
  const failures: Record<string, string> = {};

  for (const loaded of state.loaded.values()) {
    if (loaded.failure !== null) {
      failures[loaded.pluginId] = loaded.failure;
      continue;
    }
    routes.push(...loaded.routes);
    sidebarSections.push(...loaded.sidebarSections);
    settingsPages.push(...loaded.settingsPages);
    commands.push(...loaded.commands);
    projectActions.push(...loaded.projectActions);
  }

  return { routes, sidebarSections, settingsPages, commands, projectActions, failures };
}

export function getPluginWebEntryUrl(plugin: Pick<PluginInfo, "id" | "version">): string {
  // Slice 2b-2 uses the bundle convention served by PluginWebRoutes.
  return `/plugins/${encodeURIComponent(plugin.id)}/${encodeURIComponent(plugin.version)}/web/index.js`;
}

export function getPluginStylesUrl(
  plugin: Pick<PluginInfo, "id" | "version" | "hasStyles">,
): string | null {
  // A plugin that declares `entries.styles` ships a compiled stylesheet next to
  // its web bundle. The host build only scans host source, so a plugin must ship
  // its own CSS for any classes it uses that the host doesn't.
  return plugin.hasStyles
    ? `/plugins/${encodeURIComponent(plugin.id)}/${encodeURIComponent(plugin.version)}/web/index.css`
    : null;
}

const PLUGIN_STYLE_LINK_ATTR = "data-t3-plugin-styles";

/**
 * Reconcile the `<link rel="stylesheet">` elements for active web plugins that
 * ship styles: inject one per plugin (keyed by id), drop links for plugins that
 * are no longer active or whose version (href) changed. Idempotent.
 */
function reconcilePluginStyleLinks(activeWebPlugins: ReadonlyArray<PluginInfo>): void {
  if (typeof document === "undefined") {
    return;
  }
  const desired = new Map<string, string>();
  for (const plugin of activeWebPlugins) {
    const url = getPluginStylesUrl(plugin);
    if (url !== null) {
      desired.set(plugin.id, url);
    }
  }
  for (const element of Array.from(
    document.head.querySelectorAll(`link[${PLUGIN_STYLE_LINK_ATTR}]`),
  )) {
    const id = element.getAttribute(PLUGIN_STYLE_LINK_ATTR);
    if (id === null || desired.get(id) !== element.getAttribute("href")) {
      element.remove();
    }
  }
  for (const [id, url] of desired) {
    if (
      document.head.querySelector(`link[${PLUGIN_STYLE_LINK_ATTR}="${CSS.escape(id)}"]`) === null
    ) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("href", url);
      link.setAttribute(PLUGIN_STYLE_LINK_ATTR, id);
      document.head.appendChild(link);
    }
  }
}

function makePluginLogger(pluginId: PluginId): PluginUiContext["logger"] {
  const prefix = `[plugin:${pluginId}]`;
  return {
    debug: (message, data) => console.debug(prefix, message, data),
    info: (message, data) => console.info(prefix, message, data),
    warn: (message, data) => console.warn(prefix, message, data),
    error: (message, data) => console.error(prefix, message, data),
  };
}

function getDefinition(module: unknown): PluginWebDefinition {
  const candidate =
    typeof module === "object" && module !== null && "default" in module
      ? (module as { readonly default?: unknown }).default
      : null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("register" in candidate) ||
    typeof candidate.register !== "function"
  ) {
    throw new Error("Plugin web entry does not default-export a defineWebPlugin-shaped object.");
  }
  return candidate as PluginWebDefinition;
}

async function maybeAwait(value: void | Promise<void>): Promise<void> {
  await value;
}

export interface SyncPluginUiHostRegistrationsInput {
  readonly state: PluginUiHostState;
  readonly plugins: ReadonlyArray<PluginInfo>;
  readonly waitForHost: () => Promise<unknown>;
  readonly importWebPlugin: (url: string) => Promise<unknown>;
  readonly createRpc?: (pluginId: PluginId) => PluginWebRpc;
}

export async function syncPluginUiHostRegistrations({
  state,
  plugins,
  waitForHost,
  importWebPlugin,
  createRpc = pluginRpc,
}: SyncPluginUiHostRegistrationsInput): Promise<PluginUiRegistrySnapshot> {
  const activeWebPlugins = plugins.filter((plugin) => plugin.state === "active" && plugin.hasWeb);
  const activeKeys = new Set(activeWebPlugins.map((plugin) => `${plugin.id}@${plugin.version}`));

  // Inject/remove each active web plugin's stylesheet <link> alongside its JS.
  reconcilePluginStyleLinks(activeWebPlugins);

  for (const [pluginId, loaded] of state.loaded.entries()) {
    if (!activeKeys.has(`${pluginId}@${loaded.version}`)) {
      state.loaded.delete(pluginId);
    }
  }

  const pluginsToLoad = activeWebPlugins.filter((plugin) => !state.loaded.has(plugin.id));
  if (pluginsToLoad.length > 0) {
    await waitForHost();
  }

  for (const plugin of pluginsToLoad) {
    const routes: Array<RegisteredPluginRoute> = [];
    const sidebarSections: Array<RegisteredPluginSidebarSection> = [];
    const settingsPages: Array<RegisteredPluginSettingsPage> = [];
    const commands: Array<RegisteredPluginCommand> = [];
    const projectActions: Array<RegisteredPluginProjectAction> = [];

    try {
      const module = await importWebPlugin(getPluginWebEntryUrl(plugin));
      const definition = getDefinition(module);
      const ctx: PluginUiContext = {
        pluginId: plugin.id,
        rpc: createRpc(plugin.id),
        logger: makePluginLogger(plugin.id),
        registerRoute: (registration) => {
          routes.push({
            ...registration,
            pluginId: plugin.id,
            path: normalizePluginPath(registration.path),
          });
        },
        registerSidebarSection: (registration) => {
          sidebarSections.push({ ...registration, pluginId: plugin.id });
        },
        registerSettingsPage: (registration) => {
          settingsPages.push({ ...registration, pluginId: plugin.id });
        },
        registerCommand: (registration) => {
          commands.push({ ...registration, pluginId: plugin.id, context: ctx });
        },
        registerProjectAction: (registration) => {
          projectActions.push({ ...registration, pluginId: plugin.id });
        },
      };
      await maybeAwait(definition.register(ctx));
      state.loaded.set(plugin.id, {
        pluginId: plugin.id,
        version: plugin.version,
        routes,
        sidebarSections,
        settingsPages,
        commands,
        projectActions,
        failure: null,
      });
    } catch (error) {
      const message = formatPluginError(error);
      console.error(`[plugin:${plugin.id}] failed to register web UI`, error);
      state.loaded.set(plugin.id, {
        pluginId: plugin.id,
        version: plugin.version,
        routes: [],
        sidebarSections: [],
        settingsPages: [],
        commands: [],
        projectActions: [],
        failure: message,
      });
    }
  }

  return snapshotFromState(state);
}

export function resolvePluginRouteRegistration(
  snapshot: PluginUiRegistrySnapshot,
  pluginId: PluginId,
  path: string | null | undefined,
): RegisteredPluginRoute | null {
  const normalizedPath = normalizePluginPath(path ?? "");
  return (
    snapshot.routes.find((route) => route.pluginId === pluginId && route.path === normalizedPath) ??
    null
  );
}

export function resolvePluginSettingsPageRegistration(
  snapshot: PluginUiRegistrySnapshot,
  pluginId: PluginId,
  pageId: string | null | undefined,
): RegisteredPluginSettingsPage | null {
  const normalizedPageId = normalizePluginPath(pageId ?? "");
  return (
    snapshot.settingsPages.find(
      (page) => page.pluginId === pluginId && page.id === normalizedPageId,
    ) ?? null
  );
}

export function PluginUiHost() {
  const plugins = useAtomValue(pluginListAtom);
  const setRegistry = useAtomSet(pluginUiRegistryAtom);
  const stateRef = useRef<PluginUiHostState>(createPluginUiHostState());
  // Single-flight the sync: syncs mutate the shared loaded Map, and two
  // overlapping runs could import + register the same plugin twice. Chain each
  // run after the previous so they never interleave; the latest plugins list
  // always gets applied last.
  const syncChainRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const run = syncChainRef.current.then(() =>
      syncPluginUiHostRegistrations({
        state: stateRef.current,
        plugins,
        waitForHost: () => whenPluginHostReady,
        importWebPlugin: (url) => import(/* @vite-ignore */ url),
      }).then((snapshot) => {
        if (!cancelled) {
          setRegistry(snapshot);
        }
      }),
    );
    syncChainRef.current = run.catch((error) => {
      console.error("[plugin-ui-host] registry sync failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [plugins, setRegistry]);

  return null;
}

export class PluginSurfaceErrorBoundary extends Component<
  { readonly children: ReactNode; readonly label: string },
  { readonly error: Error | null }
> {
  override state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[plugin-ui] ${this.props.label} crashed`, error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Plugin surface failed to render.
        </div>
      );
    }
    return this.props.children;
  }
}
