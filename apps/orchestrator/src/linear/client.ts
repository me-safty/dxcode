const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token";

interface LinearAuthorizationCodeTokenResponse {
  readonly access_token: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly token_type?: string;
}

function readRequiredEnvVar(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Linear environment variable: ${name}`);
  }

  return value;
}

export async function exchangeLinearOAuthCode(input: {
  readonly code: string;
  readonly redirectUri: string;
}) {
  const response = await fetch(LINEAR_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: readRequiredEnvVar("LINEAR_CLIENT_ID"),
      client_secret: readRequiredEnvVar("LINEAR_CLIENT_SECRET"),
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Linear OAuth code exchange failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as LinearAuthorizationCodeTokenResponse;
}
