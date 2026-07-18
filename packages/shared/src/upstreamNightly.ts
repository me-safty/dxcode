export const NightlyTagPattern = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/;

export interface ParsedNightlyTag {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly date: number;
  readonly build: number;
}

export interface NightlyTagRef {
  readonly tag: string;
  readonly remoteObject: string;
  readonly parsed: ParsedNightlyTag;
}

const parsePart = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export function parseNightlyTag(tag: string): ParsedNightlyTag | null {
  const match = NightlyTagPattern.exec(tag);
  if (!match) return null;
  const parts = match.slice(1).map(parsePart);
  if (parts.some((part) => part === null)) return null;
  const [major, minor, patch, date, build] = parts as [number, number, number, number, number];
  return { major, minor, patch, date, build };
}

export function compareNightlyTags(left: ParsedNightlyTag, right: ParsedNightlyTag): number {
  const leftParts = [left.major, left.minor, left.patch, left.date, left.build] as const;
  const rightParts = [right.major, right.minor, right.patch, right.date, right.build] as const;
  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index]! - rightParts[index]!;
    if (delta !== 0) return delta;
  }
  return 0;
}

export function parseLsRemoteNightlyTags(output: string): ReadonlyArray<NightlyTagRef> {
  const refs = new Map<string, NightlyTagRef>();
  for (const line of output.split("\n")) {
    const [remoteObject, ref, extra] = line.trim().split(/\s+/);
    if (!remoteObject || !ref || extra || !/^[0-9a-f]{40,64}$/i.test(remoteObject)) continue;
    const prefix = "refs/tags/";
    if (!ref.startsWith(prefix) || ref.endsWith("^{}")) continue;
    const tag = ref.slice(prefix.length);
    const parsed = parseNightlyTag(tag);
    if (!parsed) continue;
    refs.set(tag, { tag, remoteObject: remoteObject.toLowerCase(), parsed });
  }
  return [...refs.values()].toSorted((left, right) =>
    compareNightlyTags(left.parsed, right.parsed),
  );
}

export function newestNightlyTag(refs: ReadonlyArray<NightlyTagRef>): NightlyTagRef | null {
  return refs.reduce<NightlyTagRef | null>(
    (newest, candidate) =>
      newest === null || compareNightlyTags(candidate.parsed, newest.parsed) > 0
        ? candidate
        : newest,
    null,
  );
}

export function countNightliesAfter(
  refs: ReadonlyArray<NightlyTagRef>,
  dismissedTag: string | null,
  newestTag: string,
): number {
  if (dismissedTag === null) return 0;
  const dismissed = parseNightlyTag(dismissedTag);
  const newest = parseNightlyTag(newestTag);
  if (!dismissed || !newest) return 0;
  return refs.filter(
    (ref) =>
      compareNightlyTags(ref.parsed, dismissed) > 0 && compareNightlyTags(ref.parsed, newest) <= 0,
  ).length;
}
