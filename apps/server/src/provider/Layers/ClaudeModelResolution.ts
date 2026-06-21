import { type ModelSelection } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";

const BEDROCK_MODEL_ID_MAP: Readonly<Record<string, string>> = {
  "claude-opus-4-8": "us.anthropic.claude-opus-4-8",
  "claude-opus-4-7": "us.anthropic.claude-opus-4-7",
  "claude-opus-4-6": "us.anthropic.claude-opus-4-6-v1",
  "claude-opus-4-5": "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
  "claude-sonnet-4-5": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
};

const OPENROUTER_MODEL_ID_MAP: Readonly<Record<string, string>> = {
  "claude-fable-5": "~anthropic/claude-fable-latest",
  "claude-opus-4-8": "~anthropic/claude-opus-latest",
  "claude-opus-4-7": "~anthropic/claude-opus-latest",
  "claude-opus-4-6": "~anthropic/claude-opus-latest",
  "claude-opus-4-5": "~anthropic/claude-opus-latest",
  "claude-sonnet-4-6": "~anthropic/claude-sonnet-latest",
  "claude-sonnet-4-5": "~anthropic/claude-sonnet-latest",
  "claude-haiku-4-5": "~anthropic/claude-haiku-latest",
  "us.anthropic.claude-opus-4-8": "~anthropic/claude-opus-latest",
  "us.anthropic.claude-opus-4-7": "~anthropic/claude-opus-latest",
  "us.anthropic.claude-opus-4-6-v1": "~anthropic/claude-opus-latest",
  "us.anthropic.claude-opus-4-5-20251101-v1:0": "~anthropic/claude-opus-latest",
  "us.anthropic.claude-sonnet-4-6": "~anthropic/claude-sonnet-latest",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "~anthropic/claude-sonnet-latest",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": "~anthropic/claude-haiku-latest",
};

function isOpenRouterClaudeEnvironment(environment: NodeJS.ProcessEnv | undefined): boolean {
  return environment?.ANTHROPIC_BASE_URL?.includes("openrouter.ai") === true;
}

export function resolveClaudeApiModelId(
  modelSelection: ModelSelection,
  environment?: NodeJS.ProcessEnv,
): string {
  if (isOpenRouterClaudeEnvironment(environment)) {
    return OPENROUTER_MODEL_ID_MAP[modelSelection.model] ?? modelSelection.model;
  }

  const resolvedModel = BEDROCK_MODEL_ID_MAP[modelSelection.model] ?? modelSelection.model;
  switch (getModelSelectionStringOptionValue(modelSelection, "contextWindow")) {
    case "1m":
      return `${resolvedModel}[1m]`;
    default:
      return resolvedModel;
  }
}
