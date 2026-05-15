import { useCallback, useRef, useState } from "react";
import {
  AtlassianOAuthApiClient,
  generatePkce,
  buildAuthorizeUrl,
  buildOAuthCallbackHandler,
  type AtlassianAccessibleResource,
  type AtlassianOAuthConfig,
  type TokenExchangeResult,
} from "@t3tools/integrations-atlassian";

const OAUTH_POPUP_WIDTH = 500;
const OAUTH_POPUP_HEIGHT = 600;
const POLL_INTERVAL_MS = 500;

export type OAuthState =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "waiting" }
  | { kind: "exchanging" }
  | { kind: "listing_sites" }
  | { kind: "done"; token: TokenExchangeResult; sites: ReadonlyArray<AtlassianAccessibleResource> }
  | { kind: "error"; message: string };

function openOAuthPopup(url: string): WindowProxy | null {
  const left = Math.round(window.screenX + (window.outerWidth - OAUTH_POPUP_WIDTH) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - OAUTH_POPUP_HEIGHT) / 2);
  return window.open(
    url,
    "atlassian-oauth",
    `width=${OAUTH_POPUP_WIDTH},height=${OAUTH_POPUP_HEIGHT},left=${left},top=${top},noopener,noreferrer`,
  );
}

function waitForCallback(
  popup: WindowProxy,
  redirectUri: string,
  timeoutMs = 120000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      if (!popup.closed) popup.close();
    };

    const timer = setInterval(() => {
      if (resolved) {
        clearInterval(timer);
        return;
      }

      if (popup.closed) {
        cleanup();
        reject(new Error("OAuth popup was closed before completing sign in."));
        return;
      }

      try {
        const href = popup.location.href;
        if (href && href.startsWith(redirectUri)) {
          cleanup();
          resolve(href);
        }
      } catch {
        // Cross-origin while on auth domain; ignore
      }

      if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error("OAuth sign in timed out. Please try again."));
      }
    }, POLL_INTERVAL_MS);
  });
}

export type UseAtlassianOAuthResult = {
  state: OAuthState;
  startOAuth: (clientId?: string) => Promise<void>;
  reset: () => void;
};

export function useAtlassianOAuth(): UseAtlassianOAuthResult {
  const [state, setState] = useState<OAuthState>({ kind: "idle" });
  const abortRef = useRef<(() => void) | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const startOAuth = useCallback(async (clientId?: string) => {
    const resolvedClientId = clientId ?? __ATLASSIAN_CLIENT_ID__;
    if (!resolvedClientId) {
      setState({
        kind: "error",
        message:
          "Atlassian OAuth is not configured. Set VITE_ATLASSIAN_CLIENT_ID or provide a client ID.",
      });
      return;
    }

    const redirectUri = `${window.location.origin}/oauth/callback`;
    const config: AtlassianOAuthConfig = {
      clientId: resolvedClientId,
      redirectUri,
    };

    setState({ kind: "opening" });

    try {
      const pkce = await generatePkce();
      const stateParam = crypto.randomUUID();
      const authUrl = buildAuthorizeUrl(config, pkce, stateParam);

      setState({ kind: "waiting" });
      const popup = openOAuthPopup(authUrl);
      if (!popup) {
        throw new Error("Failed to open OAuth popup. Check your popup blocker settings.");
      }

      const callbackUrl = await waitForCallback(popup, redirectUri);

      setState({ kind: "exchanging" });
      const handler = buildOAuthCallbackHandler(config, stateParam, pkce.codeVerifier);
      const token = await handler(callbackUrl);

      setState({ kind: "listing_sites" });
      const oauthClient = new AtlassianOAuthApiClient(config, token);
      const sites = await oauthClient.listAccessibleResources();

      setState({ kind: "done", token, sites });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth failed";
      setState({ kind: "error", message });
    }
  }, []);

  return { state, startOAuth, reset };
}
