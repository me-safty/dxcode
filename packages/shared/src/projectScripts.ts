import type { ProjectScript } from "@t3tools/contracts";

export const WORKTREE_SETUP_SCRIPT_RELATIVE_PATHS = [
  "scripts/worktree-setup.sh",
  ".t3code/worktree-setup.sh",
] as const;

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

export function setupProjectScriptCommand(command: string): string {
  const trimmed = command.trim();
  if (/^(?:bash|sh)\s+/iu.test(trimmed)) {
    return trimmed;
  }

  const shellScript = /^(?:\.\/)?(?<path>[^\s"'`]+\.sh)(?<args>\s+.*)?$/u.exec(trimmed);
  const scriptPath = shellScript?.groups?.path;
  if (scriptPath !== undefined) {
    return `bash ${scriptPath}${shellScript?.groups?.args ?? ""}`;
  }

  return trimmed;
}

export function worktreeSetupScriptCommand(relativePath: string): string {
  return `bash ${relativePath}`;
}
