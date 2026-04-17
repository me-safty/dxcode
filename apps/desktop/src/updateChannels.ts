import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;
const DESKTOP_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d{8})\.(\d+))?$/;

interface ParsedDesktopVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly nightlyDate: number | null;
  readonly nightlyRun: number | null;
}

export interface DesktopUpdateCandidate {
  readonly channel: DesktopUpdateChannel;
  readonly version: string;
}

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}

export function doesVersionMatchDesktopUpdateChannel(
  version: string,
  channel: DesktopUpdateChannel,
): boolean {
  return resolveDefaultDesktopUpdateChannel(version) === channel;
}

function parseDesktopVersion(version: string): ParsedDesktopVersion | null {
  const match = DESKTOP_VERSION_PATTERN.exec(version);
  if (!match) return null;

  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    nightlyDate: match[4] ? Number.parseInt(match[4], 10) : null,
    nightlyRun: match[5] ? Number.parseInt(match[5], 10) : null,
  };
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return Math.sign(left - right);
}

export function compareDesktopVersions(left: string, right: string): number | null {
  const leftVersion = parseDesktopVersion(left);
  const rightVersion = parseDesktopVersion(right);
  if (!leftVersion || !rightVersion) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    const difference = Math.sign(leftVersion[key] - rightVersion[key]);
    if (difference !== 0) return difference;
  }

  const nightlyDateDifference = compareNullableNumber(
    leftVersion.nightlyDate,
    rightVersion.nightlyDate,
  );
  if (nightlyDateDifference !== 0) return nightlyDateDifference;

  return compareNullableNumber(leftVersion.nightlyRun, rightVersion.nightlyRun);
}

export function isDesktopVersionOlderThanCurrent(
  candidateVersion: string,
  currentVersion: string,
): boolean {
  return compareDesktopVersions(candidateVersion, currentVersion) === -1;
}

export function selectBestDesktopUpdateCandidate(
  candidates: ReadonlyArray<DesktopUpdateCandidate>,
  currentVersion: string,
): DesktopUpdateCandidate | null {
  let bestCandidate: DesktopUpdateCandidate | null = null;

  for (const candidate of candidates) {
    if (compareDesktopVersions(candidate.version, currentVersion) !== 1) {
      continue;
    }
    if (!bestCandidate) {
      bestCandidate = candidate;
      continue;
    }

    const candidateComparison = compareDesktopVersions(candidate.version, bestCandidate.version);
    if (candidateComparison === 1) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}
