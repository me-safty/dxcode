function fnv1a32(input: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function vcsRefsCacheFileName(cwd: string): string {
  // Workspace paths can exceed the platform filename limit once URI-encoded.
  // Two independently seeded hashes keep the filename bounded; the stored cwd
  // is still validated after decoding, so a collision becomes a cache miss.
  const first = fnv1a32(cwd, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = fnv1a32(cwd, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${first}${second}.json`;
}
