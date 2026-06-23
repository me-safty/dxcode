import { describe, expect, it } from "vite-plus/test";
import { mapOffsetToNode } from "./chatFindHighlight";

describe("mapOffsetToNode", () => {
  const lengths = [3, 4, 2]; // "abc" | "defg" | "hi" → "abcdefghi"

  it("maps an offset inside the first node", () => {
    expect(mapOffsetToNode(lengths, 1)).toEqual({ nodeIndex: 0, localOffset: 1 });
  });

  it("maps an offset inside a later node", () => {
    expect(mapOffsetToNode(lengths, 5)).toEqual({ nodeIndex: 1, localOffset: 2 });
  });

  it("maps a node-boundary offset to the earlier node's end", () => {
    expect(mapOffsetToNode(lengths, 3)).toEqual({ nodeIndex: 0, localOffset: 3 });
  });

  it("maps the final offset to the last node end", () => {
    expect(mapOffsetToNode(lengths, 9)).toEqual({ nodeIndex: 2, localOffset: 2 });
  });

  it("returns null past the end", () => {
    expect(mapOffsetToNode(lengths, 10)).toBeNull();
  });
});
