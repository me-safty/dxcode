export interface WslUncPath {
  readonly distro: string;
  readonly linuxPath: string;
}

export interface WslEnvironmentCandidate<TEnvironmentId extends string = string> {
  readonly environmentId: TEnvironmentId;
  readonly backendId: string;
}

export interface WslEnvironmentConfiguration {
  readonly enabled: boolean;
  readonly wslOnly: boolean;
  readonly distro: string | null;
  readonly distros: ReadonlyArray<{
    readonly name: string;
    readonly isDefault: boolean;
  }>;
}

export interface WslProjectSelection<TEnvironmentId extends string = string> extends WslUncPath {
  readonly environmentId: TEnvironmentId;
}

const WSL_UNC_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"] as const;
const WSL_DISTRO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function parseWslUncPath(input: string): WslUncPath | null {
  const normalized = input.trim().replaceAll("/", "\\");
  const prefix = WSL_UNC_PREFIXES.find((candidate) =>
    normalized.toLowerCase().startsWith(candidate.toLowerCase()),
  );
  if (!prefix) {
    return null;
  }

  const rest = normalized.slice(prefix.length);
  const segments = rest.split("\\").filter((segment) => segment.length > 0);
  const distro = segments.shift();
  if (!distro || !WSL_DISTRO_NAME_PATTERN.test(distro)) {
    return null;
  }

  return {
    distro,
    linuxPath: segments.length === 0 ? "/" : `/${segments.join("/")}`,
  };
}

export function resolveWslProjectSelection<TEnvironmentId extends string>(
  input: string,
  candidates: ReadonlyArray<WslEnvironmentCandidate<TEnvironmentId>>,
): WslProjectSelection<TEnvironmentId> | null {
  const parsed = parseWslUncPath(input);
  if (!parsed) {
    return null;
  }

  const wslCandidates = candidates.filter((candidate) => candidate.backendId.startsWith("wsl:"));
  const exact = wslCandidates.find(
    (candidate) => candidate.backendId.toLowerCase() === `wsl:${parsed.distro}`.toLowerCase(),
  );
  return exact ? { ...parsed, environmentId: exact.environmentId } : null;
}

export function applyWslEnvironmentConfiguration<TEnvironmentId extends string>(
  candidates: ReadonlyArray<WslEnvironmentCandidate<TEnvironmentId>>,
  primaryEnvironmentId: TEnvironmentId | null,
  configuration: WslEnvironmentConfiguration | null,
): ReadonlyArray<WslEnvironmentCandidate<TEnvironmentId>> {
  if (!configuration) {
    return candidates;
  }

  const selectedDistro =
    configuration.distro ?? configuration.distros.find((distro) => distro.isDefault)?.name;
  const installedDistro = configuration.distros.find(
    (distro) => distro.name.toLowerCase() === selectedDistro?.toLowerCase(),
  );
  if (!installedDistro) {
    return candidates;
  }

  const concreteBackendId = `wsl:${installedDistro.name}`;
  const resolvedCandidates = candidates.map((candidate) =>
    candidate.backendId.toLowerCase() === "wsl:default"
      ? { ...candidate, backendId: concreteBackendId }
      : candidate,
  );

  if (
    configuration.enabled &&
    configuration.wslOnly &&
    primaryEnvironmentId !== null &&
    !resolvedCandidates.some((candidate) => candidate.environmentId === primaryEnvironmentId)
  ) {
    return [
      ...resolvedCandidates,
      { environmentId: primaryEnvironmentId, backendId: concreteBackendId },
    ];
  }

  return resolvedCandidates;
}
