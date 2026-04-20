export function normalizeCodexAuthType(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "apikey":
    case "api_key":
      return "apiKey";
    case "chatgpt":
    case "chatgptauthtokens":
    case "chatgpt_auth_tokens":
      return "chatgpt";
    default:
      return undefined;
  }
}

function codexSubscriptionLabel(planType: unknown): string | undefined {
  if (typeof planType !== "string") {
    return undefined;
  }

  switch (planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      return undefined;
  }
}

export function codexAccountAuthMetadata(input: {
  readonly accountType?: unknown;
  readonly authMode?: unknown;
  readonly planType?: unknown;
}): { readonly type?: string; readonly label?: string } | undefined {
  const type = normalizeCodexAuthType(input.accountType) ?? normalizeCodexAuthType(input.authMode);
  if (!type) {
    return undefined;
  }

  if (type === "apiKey") {
    return {
      type,
      label: "OpenAI API Key",
    };
  }

  return {
    type,
    label: codexSubscriptionLabel(input.planType) ?? "ChatGPT Subscription",
  };
}
