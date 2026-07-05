import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import { clerkFrontendApiHostnameFromPublishableKey } from "@pathwayos/shared/relayAuth";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

declare const __PATHWAYOS_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

export class DesktopClerkBridgeInitializationError extends Schema.TaggedErrorClass<DesktopClerkBridgeInitializationError>()(
  "DesktopClerkBridgeInitializationError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeCleanupError extends Schema.TaggedErrorClass<DesktopClerkBridgeCleanupError>()(
  "DesktopClerkBridgeCleanupError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean up the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
    readonly installNativeRequestHeaderSanitizer: Effect.Effect<void, never, Scope.Scope>;
  }
>()("@pathwayos/desktop/app/DesktopClerk") {}

export function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    return clerkFrontendApiHostnameFromPublishableKey(normalizedKey);
  } catch {
    return undefined;
  }
}

export const desktopClerkFrontendApiHostname = resolveDesktopClerkFrontendApiHostname(
  typeof __PATHWAYOS_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? undefined
    : __PATHWAYOS_BUILD_CLERK_PUBLISHABLE_KEY__,
);

export function sanitizeClerkNativeRequestHeaders(
  details: Pick<Electron.OnBeforeSendHeadersListenerDetails, "requestHeaders" | "url">,
  clerkFrontendApiHostname: string | undefined,
): Record<string, string> {
  if (!isClerkNativeRequestUrl(details.url, clerkFrontendApiHostname)) {
    return details.requestHeaders;
  }

  let sanitizedHeaders: Record<string, string> | undefined;
  for (const headerName of Object.keys(details.requestHeaders)) {
    if (headerName.toLowerCase() === "origin") {
      sanitizedHeaders ??= { ...details.requestHeaders };
      delete sanitizedHeaders[headerName];
    }
  }

  return sanitizedHeaders ?? details.requestHeaders;
}

export function withClerkNativeCorsResponseHeaders(
  details: Pick<Electron.OnHeadersReceivedListenerDetails, "responseHeaders" | "url">,
  clerkFrontendApiHostname: string | undefined,
  rendererOrigin: string,
): Record<string, string | string[]> {
  const responseHeaders = { ...details.responseHeaders };
  if (!isClerkNativeRequestUrl(details.url, clerkFrontendApiHostname)) {
    return responseHeaders;
  }

  setResponseHeader(responseHeaders, "Access-Control-Allow-Origin", rendererOrigin);
  setResponseHeader(
    responseHeaders,
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  setResponseHeader(responseHeaders, "Access-Control-Allow-Headers", "authorization,content-type");
  setResponseHeader(responseHeaders, "Access-Control-Expose-Headers", "authorization");
  setResponseHeader(responseHeaders, "Access-Control-Max-Age", "600");
  return responseHeaders;
}

function isClerkNativeRequestUrl(
  rawUrl: string,
  clerkFrontendApiHostname: string | undefined,
): boolean {
  if (!clerkFrontendApiHostname) {
    return false;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
  } catch {
    return false;
  }

  return (
    requestUrl.protocol === "https:" &&
    requestUrl.hostname === clerkFrontendApiHostname &&
    requestUrl.searchParams.get("_is_native") === "1"
  );
}

function setResponseHeader(
  responseHeaders: Record<string, string | string[]>,
  headerName: string,
  value: string,
): void {
  for (const existingHeaderName of Object.keys(responseHeaders)) {
    if (existingHeaderName.toLowerCase() === headerName.toLowerCase()) {
      delete responseHeaders[existingHeaderName];
    }
  }
  responseHeaders[headerName] = [value];
}

export function installClerkNativeRequestHeaderSanitizer(
  clerkFrontendApiHostname: string | undefined,
  rendererOrigin: string,
): Effect.Effect<void, never, Scope.Scope> {
  if (!clerkFrontendApiHostname) {
    return Effect.void;
  }

  const filter = { urls: [`https://${clerkFrontendApiHostname}/*`] };
  const listener = (
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (beforeSendResponse: Electron.BeforeSendResponse) => void,
  ) => {
    callback({
      requestHeaders: sanitizeClerkNativeRequestHeaders(details, clerkFrontendApiHostname),
    });
  };
  const responseListener = (
    details: Electron.OnHeadersReceivedListenerDetails,
    callback: (headersReceivedResponse: Electron.HeadersReceivedResponse) => void,
  ) => {
    callback({
      responseHeaders: withClerkNativeCorsResponseHeaders(
        details,
        clerkFrontendApiHostname,
        rendererOrigin,
      ),
    });
  };

  return Effect.acquireRelease(
    Effect.sync(() => {
      Electron.session.defaultSession.webRequest.onBeforeSendHeaders(filter, listener);
      Electron.session.defaultSession.webRequest.onHeadersReceived(filter, responseListener);
    }),
    () =>
      Effect.sync(() => {
        Electron.session.defaultSession.webRequest.onBeforeSendHeaders(filter, null);
        Electron.session.defaultSession.webRequest.onHeadersReceived(filter, null);
      }),
  ).pipe(Effect.asVoid);
}

export function createDesktopClerkBridge(stateDir: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: stateDir }),
    passkeys: true,
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
      privileges: {
        corsEnabled: false,
      },
    },
  });
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => createDesktopClerkBridge(environment.stateDir, environment.isDevelopment),
      catch: (cause) =>
        new DesktopClerkBridgeInitializationError({
          stateDir: environment.stateDir,
          isDevelopment: environment.isDevelopment,
          cause,
        }),
    }),
    (bridge) =>
      Effect.try({
        try: () => bridge.cleanup(),
        catch: (cause) =>
          new DesktopClerkBridgeCleanupError({
            stateDir: environment.stateDir,
            isDevelopment: environment.isDevelopment,
            cause,
          }),
      }).pipe(Effect.orDie),
  );

  return DesktopClerk.of({
    installNativeRequestHeaderSanitizer: installClerkNativeRequestHeaderSanitizer(
      desktopClerkFrontendApiHostname,
      ElectronProtocol.getDesktopOrigin(environment.isDevelopment),
    ).pipe(Effect.withSpan("desktop.clerk.installNativeRequestHeaderSanitizer")),
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      if (!(yield* electronApp.requestSingleInstanceLock)) {
        yield* electronApp.quit;
        return yield* Effect.interrupt;
      }

      yield* electronApp.on("second-instance", () => {
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) {
              yield* electronWindow.reveal(mainWindow.value);
            }
          }),
        );
      });
    }).pipe(Effect.withSpan("desktop.clerk.configure")),
  });
});

export const layer = Layer.effect(DesktopClerk, make);
