import {
  PluginCommandName,
  PluginId,
  type PluginCatalogEntry,
  type PluginRouteId,
  type PluginRouteSurface,
} from "@t3tools/contracts";
import type {
  PluginUiContext,
  PluginUiFactory,
  PluginUiProject,
  PluginUiRegistration,
  T3PluginHostGlobal,
} from "@t3tools/plugin-api/ui";
import { useNavigate, type AnyRouter } from "@tanstack/react-router";
import * as React from "react";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import type { WsRpcClient } from "@t3tools/client-runtime";

import { toastManager } from "../components/ui/toast";
import { SidebarInset } from "../components/ui/sidebar";
import { resolvePrimaryEnvironmentHttpUrl, usePrimaryEnvironmentId } from "../environments/primary";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { readLocalApi } from "../localApi";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { createPluginUiComponents } from "./pluginUiComponents";

interface PluginHostState {
  readonly catalog: ReadonlyArray<PluginCatalogEntry>;
  readonly factories: ReadonlyMap<string, PluginUiFactory>;
  readonly loadedScripts: ReadonlySet<string>;
  readonly loadingScripts: ReadonlySet<string>;
  readonly loadErrors: ReadonlyMap<string, string>;
  readonly client: WsRpcClient | null;
}

type PluginRouteResolution =
  | { readonly status: "loading" }
  | { readonly status: "missing"; readonly message: string }
  | { readonly status: "failed"; readonly catalogEntry: PluginCatalogEntry }
  | {
      readonly status: "ready";
      readonly catalogEntry: PluginCatalogEntry;
      readonly context: PluginUiContext;
      readonly registration: PluginUiRegistration;
    };

type DynamicNavigate = ReturnType<typeof useNavigate<AnyRouter>>;

function usePluginProjects(): ReadonlyArray<PluginUiProject> {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  return useMemo(
    () =>
      projects
        .filter(
          (project) =>
            primaryEnvironmentId === null || project.environmentId === primaryEnvironmentId,
        )
        .sort((first, second) => first.name.localeCompare(second.name))
        .map((project) => ({
          id: project.id,
          name: project.name,
          environmentId: project.environmentId,
        })),
    [primaryEnvironmentId, projects],
  );
}

function pluginThreadHref(input: {
  readonly environmentId: string;
  readonly threadId: string;
}): string {
  return `/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

async function confirmPluginAction(message: string): Promise<boolean> {
  return (await readLocalApi()?.dialogs.confirm(message)) ?? window.confirm(message);
}

let state: PluginHostState = {
  catalog: [],
  factories: new Map(),
  loadedScripts: new Set(),
  loadingScripts: new Set(),
  loadErrors: new Map(),
  client: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function updateState(updater: (current: PluginHostState) => PluginHostState) {
  state = updater(state);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function globalPluginHost(): Window & { T3PluginHost?: T3PluginHostGlobal } {
  return window as Window & { T3PluginHost?: T3PluginHostGlobal };
}

function installGlobalHost() {
  if (typeof window === "undefined") {
    return;
  }

  globalPluginHost().T3PluginHost = {
    register: (pluginIdInput, factory) => {
      const pluginId = String(pluginIdInput);
      updateState((current) => {
        const factories = new Map(current.factories);
        factories.set(pluginId, factory);
        return { ...current, factories };
      });
    },
  };
}

function scriptUrlFor(entry: PluginCatalogEntry): string {
  return resolvePrimaryEnvironmentHttpUrl(entry.assets.client);
}

function markScriptLoading(pluginId: string) {
  updateState((current) => {
    const loadingScripts = new Set(current.loadingScripts);
    loadingScripts.add(pluginId);
    const loadErrors = new Map(current.loadErrors);
    loadErrors.delete(pluginId);
    return { ...current, loadingScripts, loadErrors };
  });
}

function markScriptLoaded(pluginId: string) {
  updateState((current) => {
    const loadingScripts = new Set(current.loadingScripts);
    loadingScripts.delete(pluginId);
    const loadedScripts = new Set(current.loadedScripts);
    loadedScripts.add(pluginId);
    return { ...current, loadingScripts, loadedScripts };
  });
}

function markScriptFailed(pluginId: string, message: string) {
  updateState((current) => {
    const loadingScripts = new Set(current.loadingScripts);
    loadingScripts.delete(pluginId);
    const loadErrors = new Map(current.loadErrors);
    loadErrors.set(pluginId, message);
    return { ...current, loadingScripts, loadErrors };
  });
}

function loadPluginScript(entry: PluginCatalogEntry) {
  const pluginId = entry.manifest.id;
  if (state.loadedScripts.has(pluginId) || state.loadingScripts.has(pluginId)) {
    return;
  }
  markScriptLoading(pluginId);

  const script = document.createElement("script");
  script.async = true;
  script.src = scriptUrlFor(entry);
  script.dataset.t3PluginId = pluginId;
  script.addEventListener("load", () => markScriptLoaded(pluginId), {
    once: true,
  });
  script.addEventListener(
    "error",
    () => markScriptFailed(pluginId, "Failed to load plugin client bundle."),
    { once: true },
  );
  document.head.appendChild(script);
}

function loadActivePluginScripts(catalog: ReadonlyArray<PluginCatalogEntry>) {
  for (const entry of catalog) {
    if (entry.status.status === "active") {
      loadPluginScript(entry);
    }
  }
}

async function refreshCatalog(client: WsRpcClient) {
  const result = await client.plugins.list();
  updateState((current) => ({ ...current, catalog: result.plugins, client }));
  loadActivePluginScripts(result.plugins);
}

export function startPluginHost(client: WsRpcClient) {
  installGlobalHost();
  updateState((current) => ({ ...current, client }));
  void refreshCatalog(client).catch((error) => {
    toastManager.add({
      type: "error",
      title: "Could not load plugins",
      description: error instanceof Error ? error.message : "Plugin catalog request failed.",
    });
  });

  return client.plugins.subscribe(
    {},
    () => {
      void refreshCatalog(client);
    },
    {
      onResubscribe: () => {
        void refreshCatalog(client);
      },
    },
  );
}

export function PluginHostBootstrap() {
  useEffect(() => {
    return startPluginHost(getPrimaryEnvironmentConnection().client);
  }, []);

  return null;
}

export function usePluginCatalog(): ReadonlyArray<PluginCatalogEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).catalog;
}

export function usePluginHostState(): PluginHostState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function createPluginContext(input: {
  readonly client: WsRpcClient;
  readonly catalogEntry: PluginCatalogEntry;
  readonly routeId: PluginRouteId;
  readonly routeSurface: PluginRouteSurface;
  readonly navigate: DynamicNavigate;
}): PluginUiContext {
  const pluginId = input.catalogEntry.manifest.id;

  return {
    pluginId,
    catalogEntry: input.catalogEntry,
    uiApiVersion: 1,
    route: {
      id: input.routeId,
      surface: input.routeSurface,
    },
    react: React as unknown as PluginUiContext["react"],
    api: {
      invoke: async (command, commandInput) => {
        const result = await input.client.plugins.invoke({
          pluginId,
          command: PluginCommandName.make(String(command)),
          input: commandInput,
        });
        return result.output;
      },
    },
    host: {
      useProjects: usePluginProjects,
      confirm: confirmPluginAction,
      threadHref: pluginThreadHref,
    },
    navigation: {
      navigate: (to) => {
        void input.navigate({ to });
      },
    },
    toast: {
      success: (title, description) => {
        toastManager.add({ type: "success", title, description });
      },
      error: (title, description) => {
        toastManager.add({ type: "error", title, description });
      },
    },
    components: createPluginUiComponents(input.routeSurface),
  };
}

function resolvePluginRoute(input: {
  readonly hostState: PluginHostState;
  readonly pluginId: PluginId;
  readonly routeId: PluginRouteId;
  readonly surface: PluginRouteSurface;
  readonly navigate: ReturnType<typeof useNavigate>;
}): PluginRouteResolution {
  const catalogEntry = input.hostState.catalog.find(
    (entry) => entry.manifest.id === input.pluginId,
  );
  if (!catalogEntry) {
    return input.hostState.catalog.length === 0
      ? { status: "loading" }
      : {
          status: "missing",
          message: `Plugin ${input.pluginId} was not found.`,
        };
  }
  if (catalogEntry.status.status === "failed") {
    return { status: "failed", catalogEntry };
  }
  if (catalogEntry.status.status !== "active") {
    return {
      status: "missing",
      message: `Plugin ${input.pluginId} is ${catalogEntry.status.status}.`,
    };
  }
  const routeContribution = catalogEntry.manifest.routes.find(
    (route) => route.id === input.routeId,
  );
  if (!routeContribution) {
    return {
      status: "missing",
      message: `Plugin route ${input.routeId} was not found.`,
    };
  }
  if (routeContribution.surface !== input.surface) {
    return {
      status: "missing",
      message: `Plugin route ${input.routeId} is not available on the ${input.surface} surface.`,
    };
  }

  const factory = input.hostState.factories.get(input.pluginId);
  if (!factory) {
    const loadError = input.hostState.loadErrors.get(input.pluginId);
    return loadError ? { status: "missing", message: loadError } : { status: "loading" };
  }
  if (!input.hostState.client) {
    return { status: "loading" };
  }

  const context = createPluginContext({
    client: input.hostState.client,
    catalogEntry,
    routeId: input.routeId,
    routeSurface: input.surface,
    navigate: input.navigate,
  });
  const registration = factory(context);
  if (!registration.routes[input.routeId]) {
    return {
      status: "missing",
      message: `Plugin route ${input.routeId} was not found.`,
    };
  }
  return {
    status: "ready",
    catalogEntry,
    context,
    registration,
  };
}

export function PluginRouteView({
  pluginId,
  routeId,
  surface,
}: {
  readonly pluginId: PluginId;
  readonly routeId: PluginRouteId;
  readonly surface: PluginRouteSurface;
}) {
  const hostState = usePluginHostState();
  const navigate = useNavigate<AnyRouter>();
  const resolution = useMemo(
    () => resolvePluginRoute({ hostState, pluginId, routeId, surface, navigate }),
    [hostState, navigate, pluginId, routeId, surface],
  );

  if (resolution.status === "loading") {
    return <PluginRouteShell surface={surface} title="Loading plugin" />;
  }

  if (resolution.status === "failed") {
    return (
      <PluginRouteShell
        surface={surface}
        title={`${resolution.catalogEntry.manifest.name} failed to start`}
        description={resolution.catalogEntry.status.diagnostics?.join("\n") ?? "No diagnostics."}
      />
    );
  }

  if (resolution.status === "missing") {
    return (
      <PluginRouteShell
        surface={surface}
        title="Plugin unavailable"
        description={resolution.message}
      />
    );
  }

  const route = resolution.registration.routes[routeId];
  if (!route) {
    return <PluginRouteShell surface={surface} title="Plugin route unavailable" />;
  }
  return <>{route({ ctx: resolution.context }) as ReactNode}</>;
}

function PluginRouteShell({
  surface,
  title,
  description,
}: {
  readonly surface: PluginRouteSurface;
  readonly title: string;
  readonly description?: string;
}) {
  const content = (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-base font-medium">{title}</h1>
        {description ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );

  return surface === "settings" ? (
    content
  ) : (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {content}
    </SidebarInset>
  );
}
