const CODEX_APP_SERVER_BASE_REASONING_EFFORT = "medium";

/**
 * T3 Code sends the selected reasoning effort with each turn. Pin the app-server
 * startup default to a portable value so config written by a newer Codex build
 * cannot prevent an older configured binary from loading.
 */
export function buildCodexAppServerArgs(
  extraArgs: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  return [
    "app-server",
    "--config",
    `model_reasoning_effort="${CODEX_APP_SERVER_BASE_REASONING_EFFORT}"`,
    ...extraArgs,
  ];
}
