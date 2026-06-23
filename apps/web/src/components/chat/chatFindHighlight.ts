/**
 * Resolve a character `offset` (into the concatenated text of consecutive text
 * nodes whose lengths are `lengths`) to a `(nodeIndex, localOffset)` pair. A
 * boundary offset binds to the earlier node's end so a Range start/end can sit
 * exactly at a node edge. Returns null when offset exceeds the total length.
 */
export function mapOffsetToNode(
  lengths: ReadonlyArray<number>,
  offset: number,
): { nodeIndex: number; localOffset: number } | null {
  if (offset < 0) return null;
  let acc = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const len = lengths[index] ?? 0;
    if (offset <= acc + len) {
      return { nodeIndex: index, localOffset: offset - acc };
    }
    acc += len;
  }
  return null;
}
