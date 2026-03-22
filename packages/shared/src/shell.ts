import { execFileSync } from "node:child_process";

const PATH_CAPTURE_START = "__T3CODE_PATH_START__";
const PATH_CAPTURE_END = "__T3CODE_PATH_END__";
const SHELL_ENV_NAME_PATTERN = /^[A-Z0-9_]+$/;

type ExecFileSyncLike = (
  file: string,
  args: ReadonlyArray<string>,
  options: { encoding: "utf8"; timeout: number },
) => string;

export function extractPathFromShellOutput(output: string): string | null {
  const startIndex = output.indexOf(PATH_CAPTURE_START);
  if (startIndex === -1) return null;

  const valueStartIndex = startIndex + PATH_CAPTURE_START.length;
  const endIndex = output.indexOf(PATH_CAPTURE_END, valueStartIndex);
  if (endIndex === -1) return null;

  const pathValue = output.slice(valueStartIndex, endIndex).trim();
  return pathValue.length > 0 ? pathValue : null;
}

export function readPathFromLoginShell(
  shell: string,
  execFile: ExecFileSyncLike = execFileSync,
): string | undefined {
  return readEnvironmentFromLoginShell(shell, ["PATH"], execFile).PATH;
}

function envCaptureStart(name: string): string {
  return `__T3CODE_ENV_${name}_START__`;
}

function envCaptureEnd(name: string): string {
  return `__T3CODE_ENV_${name}_END__`;
}

function isNushell(shell: string): boolean {
  const base = shell.split("/").pop() ?? "";
  return base === "nu" || base.startsWith("nu.");
}

function buildEnvironmentCaptureCommand(names: ReadonlyArray<string>): string {
  return names
    .map((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }

      return [
        `printf '%s\\n' '${envCaptureStart(name)}'`,
        `printenv ${name} || true`,
        `printf '%s\\n' '${envCaptureEnd(name)}'`,
      ].join("; ");
    })
    .join("; ");
}

/**
 * Build a nushell-native command that captures environment variables using
 * the same marker protocol as the POSIX variant. Nushell stores PATH as a
 * list, so we join it with ":" to match the expected format. For other
 * variables we use `try { print $env.X } catch { }` because nushell
 * throws on missing env vars.
 */
function buildNushellEnvironmentCaptureCommand(names: ReadonlyArray<string>): string {
  return names
    .map((name) => {
      const start = envCaptureStart(name);
      const end = envCaptureEnd(name);

      if (name === "PATH") {
        return `print "${start}"; print ($env.PATH | str join ":"); print "${end}"`;
      }

      return `print "${start}"; try { print $env.${name} } catch { }; print "${end}"`;
    })
    .join("; ");
}

function extractEnvironmentValue(output: string, name: string): string | undefined {
  const startMarker = envCaptureStart(name);
  const endMarker = envCaptureEnd(name);
  const startIndex = output.indexOf(startMarker);
  if (startIndex === -1) return undefined;

  const valueStartIndex = startIndex + startMarker.length;
  const endIndex = output.indexOf(endMarker, valueStartIndex);
  if (endIndex === -1) return undefined;

  let value = output.slice(valueStartIndex, endIndex);
  if (value.startsWith("\n")) {
    value = value.slice(1);
  }
  if (value.endsWith("\n")) {
    value = value.slice(0, -1);
  }

  return value.length > 0 ? value : undefined;
}

export type ShellEnvironmentReader = (
  shell: string,
  names: ReadonlyArray<string>,
  execFile?: ExecFileSyncLike,
) => Partial<Record<string, string>>;

export const readEnvironmentFromLoginShell: ShellEnvironmentReader = (
  shell,
  names,
  execFile = execFileSync,
) => {
  if (names.length === 0) {
    return {};
  }

  // Nushell doesn't support bundled flags (-ilc) or POSIX syntax (||, printf).
  // Use separate flags and a nu-native capture command instead.
  const nu = isNushell(shell);
  const command = nu
    ? buildNushellEnvironmentCaptureCommand(names)
    : buildEnvironmentCaptureCommand(names);
  const args = nu ? ["-l", "-c", command] : ["-ilc", command];

  const output = execFile(shell, args, {
    encoding: "utf8",
    timeout: 5000,
  });

  const environment: Partial<Record<string, string>> = {};
  for (const name of names) {
    const value = extractEnvironmentValue(output, name);
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
};
