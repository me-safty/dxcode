const POSIX_SHELL_SAFE_WORD_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;
const POWERSHELL_SAFE_WORD_PATTERN = /^[A-Za-z0-9_@%+=:,./\\-]+$/;
const SHELL_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function containsNullByte(value: string): boolean {
  return value.includes("\0");
}

function quotePosixShellWord(value: string): string | null {
  if (containsNullByte(value)) {
    return null;
  }
  if (value.length > 0 && POSIX_SHELL_SAFE_WORD_PATTERN.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quotePowerShellStringLiteral(value: string): string | null {
  if (containsNullByte(value)) {
    return null;
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function quotePowerShellWord(value: string): string | null {
  if (containsNullByte(value)) {
    return null;
  }
  if (value.length > 0 && POWERSHELL_SAFE_WORD_PATTERN.test(value)) {
    return value;
  }
  return quotePowerShellStringLiteral(value);
}

/**
 * Render the structured maintenance action for the host's interactive shell.
 * Returns null instead of publishing a command that would lose environment,
 * argument boundaries, or executable-path quoting.
 */
export function makeProviderMaintenanceManualCommand(input: {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>> | null;
  readonly platform?: NodeJS.Platform;
}): string | null {
  const envEntries = Object.entries(input.env ?? {}).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (envEntries.some(([name]) => !SHELL_ENV_NAME_PATTERN.test(name))) {
    return null;
  }

  // Module-level static capabilities do not have an Effect runtime from
  // which to read the host platform. Preserve the existing portable command
  // form for simple words, but do not guess a shell when quoting or
  // environment assignment syntax would be platform-specific.
  if (input.platform === undefined) {
    const words = [input.executable, ...input.args];
    return envEntries.length === 0 &&
      words.every(
        (word) =>
          !containsNullByte(word) && word.length > 0 && POSIX_SHELL_SAFE_WORD_PATTERN.test(word),
      )
      ? words.join(" ")
      : null;
  }

  if (input.platform === "win32") {
    const executable = quotePowerShellWord(input.executable);
    const args = input.args.map(quotePowerShellWord);
    const env = envEntries.map(([name, value]) => {
      // Assignment RHS is parsed in PowerShell's expression mode rather than
      // native-command argument mode, so even path-looking values must be
      // explicit string literals.
      const quotedValue = quotePowerShellStringLiteral(value);
      return quotedValue === null ? null : `$env:${name} = ${quotedValue}`;
    });
    if (
      executable === null ||
      args.some((arg) => arg === null) ||
      env.some((item) => item === null)
    ) {
      return null;
    }

    const invocation = [
      POWERSHELL_SAFE_WORD_PATTERN.test(input.executable) ? executable : `& ${executable}`,
      ...args,
    ].join(" ");
    return [...env, invocation].join("; ");
  }

  const executable = quotePosixShellWord(input.executable);
  const args = input.args.map(quotePosixShellWord);
  const env = envEntries.map(([name, value]) => {
    const quotedValue = quotePosixShellWord(value);
    return quotedValue === null ? null : `${name}=${quotedValue}`;
  });
  if (
    executable === null ||
    args.some((arg) => arg === null) ||
    env.some((item) => item === null)
  ) {
    return null;
  }
  return [...env, executable, ...args].join(" ");
}
