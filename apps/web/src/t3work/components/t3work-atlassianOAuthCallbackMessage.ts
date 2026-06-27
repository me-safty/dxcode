export const ATLASSIAN_OAUTH_CALLBACK_MESSAGE_TYPE = "t3work-atlassian-oauth-callback" as const;

export type AtlassianOAuthCallbackMessage = {
  readonly type: typeof ATLASSIAN_OAUTH_CALLBACK_MESSAGE_TYPE;
  readonly href: string;
};

export function postAtlassianOAuthCallbackToOpener(href: string): boolean {
  const opener = window.opener;
  if (!opener || opener.closed) {
    return false;
  }

  const message: AtlassianOAuthCallbackMessage = {
    type: ATLASSIAN_OAUTH_CALLBACK_MESSAGE_TYPE,
    href,
  };
  opener.postMessage(message, "*");
  return true;
}
