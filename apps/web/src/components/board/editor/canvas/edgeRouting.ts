export const LANE_CARD_WIDTH = 240;
export const LANE_GAP_X = 72;
export const LANE_GAP_Y = 48;

export const CHANNEL_CLEARANCE = 36;
export const CHANNEL_SPACING = 16;
const CHANNEL_MARGIN = 16;
const PORT_SPACING = 14;

export interface EdgeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RoutedEdgePath {
  readonly d: string;
  readonly labelX: number;
  readonly labelY: number;
}

export type EdgeGeometry =
  | { readonly kind: "forward" }
  | { readonly kind: "vertical" }
  | { readonly kind: "channel"; readonly channel: "top" | "bottom" };

/**
 * Classify how an edge should travel based on where its lanes actually sit:
 * - forward: target is in the next column to the right — a direct curve
 *   between facing sides stays in the column gap and reads cleanly.
 * - vertical: lanes overlap horizontally (same column) — a short curve
 *   between bottom and top edges.
 * - channel: anything longer (multi-column spans and back-edges) detours
 *   through the clear space above or below the lane grid instead of cutting
 *   underneath intermediate cards. Back-edges take the top channel, long
 *   forward spans the bottom, so the two directions never share a corridor.
 */
export const classifyEdge = (source: EdgeRect, target: EdgeRect): EdgeGeometry => {
  const horizontalOverlap =
    Math.min(source.x + source.width, target.x + target.width) > Math.max(source.x, target.x);
  if (horizontalOverlap) {
    return { kind: "vertical" };
  }
  const forwardGap = target.x - (source.x + source.width);
  if (forwardGap >= 0 && forwardGap <= LANE_GAP_X + LANE_CARD_WIDTH / 2) {
    return { kind: "forward" };
  }
  return { kind: "channel", channel: target.x < source.x ? "top" : "bottom" };
};

export type CardSide = "left" | "right" | "top" | "bottom";

/**
 * The physical card side each endpoint of an edge attaches to. Several edge
 * geometries share a side (a forward edge and a rightward channel edge both
 * leave through the right side), so port slots must be allocated per side —
 * not per geometry kind — or edges of different kinds stack on one point.
 */
export const edgeEndpointSides = (
  source: EdgeRect,
  target: EdgeRect,
): { readonly source: CardSide; readonly target: CardSide } => {
  const geometry = classifyEdge(source, target);
  if (geometry.kind === "forward") {
    return { source: "right", target: "left" };
  }
  if (geometry.kind === "vertical") {
    const goingDown = target.y >= source.y + source.height;
    return goingDown ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
  }
  const travelingRight = target.x > source.x;
  return travelingRight ? { source: "right", target: "left" } : { source: "left", target: "right" };
};

/**
 * Vertical space a stack of corridors needs outside the lane band. `count` is
 * the corridor span (max channel slot + 1) and may be fractional once
 * inter-group gaps are added — `channelSlotsWithGaps` returns those slots.
 */
export const channelExtent = (count: number): number =>
  count <= 0 ? 0 : CHANNEL_CLEARANCE + (count - 1) * CHANNEL_SPACING + CHANNEL_MARGIN;

/**
 * Big gap (in slot units) inserted between corridors whose edges leave
 * DIFFERENT source lanes, so each lane's fan-out reads as one bundle with a
 * clear gutter before the next lane's. ~1.3 of a slot (`CHANNEL_SPACING`).
 */
export const CHANNEL_LANE_GAP = 1.3;

/**
 * Small gap (in slot units) inserted between different categories
 * (routes / transitions / actions) WITHIN the same source lane, so the
 * green-red-yellow, grey, and blue groups read as distinct sub-bundles.
 * ~0.5 of a slot.
 */
export const CHANNEL_CATEGORY_GAP = 0.5;

export interface ChannelSlotInput {
  /** Source-lane order index (ascending = earlier-defined lane). */
  readonly laneIndex: number;
  /** Category order: 0 = routes, 1 = transitions, 2 = actions. */
  readonly category: number;
}

/**
 * Assign a (possibly fractional) channel slot to each corridor edge.
 *
 * Edges are sorted by (laneIndex, category) — STABLY, so the caller's input
 * order is preserved within a category — then walked, assigning consecutive
 * slots and inserting:
 * - 0 gap between edges of the same category in the same lane (tight bundle),
 * - `CHANNEL_CATEGORY_GAP` when only the category changes within a lane,
 * - `CHANNEL_LANE_GAP` when the source lane changes.
 *
 * Both the router and the band-extent reservation call this with the same
 * inputs, so their max slot (and therefore reserved depth) match exactly.
 */
export const assignChannelSlots = <T extends ChannelSlotInput>(
  edges: ReadonlyArray<T>,
): ReadonlyArray<{ readonly edge: T; readonly slot: number }> => {
  const ordered = edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      if (left.edge.laneIndex !== right.edge.laneIndex) {
        return left.edge.laneIndex - right.edge.laneIndex;
      }
      if (left.edge.category !== right.edge.category) {
        return left.edge.category - right.edge.category;
      }
      return left.index - right.index;
    });

  const result: { readonly edge: T; readonly slot: number }[] = [];
  let cursor = 0;
  let previous: ChannelSlotInput | null = null;
  for (const { edge } of ordered) {
    if (previous !== null) {
      if (previous.laneIndex !== edge.laneIndex) {
        cursor += CHANNEL_LANE_GAP;
      } else if (previous.category !== edge.category) {
        cursor += CHANNEL_CATEGORY_GAP;
      }
    }
    result.push({ edge, slot: cursor });
    cursor += 1;
    previous = edge;
  }
  return result;
};

/** Corridor span (max slot + 1, or 0 when empty) for `channelExtent`. */
export const channelCorridorSpan = (edges: ReadonlyArray<ChannelSlotInput>): number => {
  const slots = assignChannelSlots(edges);
  return slots.length === 0 ? 0 : Math.max(...slots.map((entry) => entry.slot)) + 1;
};

const portOffset = (slot: number, count: number): number => (slot - (count - 1) / 2) * PORT_SPACING;

export interface EdgeRouteInput {
  readonly source: EdgeRect;
  readonly target: EdgeRect;
  /** Slot/count along the chosen source side, to fan out parallel edges. */
  readonly sourceSlot: number;
  readonly sourceCount: number;
  readonly targetSlot: number;
  readonly targetCount: number;
  /** For channel edges: 0-based corridor index so parallel detours stack. */
  readonly channelSlot: number;
  /** Y of the top of the lane band — top corridors hang above this. */
  readonly laneBandTop: number;
  /** Y of the bottom of the lane band — bottom corridors run below this. */
  readonly laneBandBottom: number;
}

export const routeEdge = (input: EdgeRouteInput): RoutedEdgePath => {
  const geometry = classifyEdge(input.source, input.target);

  if (geometry.kind === "forward") {
    const sx = input.source.x + input.source.width;
    const sy =
      input.source.y + input.source.height / 2 + portOffset(input.sourceSlot, input.sourceCount);
    const tx = input.target.x;
    const ty =
      input.target.y + input.target.height / 2 + portOffset(input.targetSlot, input.targetCount);
    const delta = Math.max(32, (tx - sx) / 2);
    return {
      d: `M ${sx} ${sy} C ${sx + delta} ${sy}, ${tx - delta} ${ty}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2 - 4,
    };
  }

  if (geometry.kind === "vertical") {
    const goingDown = input.target.y >= input.source.y + input.source.height;
    const sx =
      input.source.x + input.source.width / 2 + portOffset(input.sourceSlot, input.sourceCount);
    const tx =
      input.target.x + input.target.width / 2 + portOffset(input.targetSlot, input.targetCount);
    const sy = goingDown ? input.source.y + input.source.height : input.source.y;
    const ty = goingDown ? input.target.y : input.target.y + input.target.height;
    const delta = Math.max(24, Math.abs(ty - sy) / 2);
    const sign = goingDown ? 1 : -1;
    return {
      d: `M ${sx} ${sy} C ${sx} ${sy + sign * delta}, ${tx} ${ty - sign * delta}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2,
    };
  }

  // Channel detour: exit through the side facing the travel direction, drop
  // down (or rise) through the empty column gap beside the card — never
  // through cards stacked above/below it — run along the clear corridor
  // outside the lane band, and enter the target the same way from its
  // facing side.
  const top = geometry.channel === "top";
  const travelingRight = input.target.x > input.source.x;
  const channelY = top
    ? input.laneBandTop - CHANNEL_CLEARANCE - input.channelSlot * CHANNEL_SPACING
    : input.laneBandBottom + CHANNEL_CLEARANCE + input.channelSlot * CHANNEL_SPACING;
  const sy =
    input.source.y + input.source.height / 2 + portOffset(input.sourceSlot, input.sourceCount);
  const ty =
    input.target.y + input.target.height / 2 + portOffset(input.targetSlot, input.targetCount);
  const sx = travelingRight ? input.source.x + input.source.width : input.source.x;
  const tx = travelingRight ? input.target.x : input.target.x + input.target.width;
  const r = 12;
  const corridorOffset = Math.min(
    LANE_GAP_X / 2 + input.channelSlot * 8,
    Math.max(0, Math.abs(tx - sx) / 2 - r),
  );
  const corridorS = travelingRight ? sx + corridorOffset : sx - corridorOffset;
  const corridorT = travelingRight ? tx - corridorOffset : tx + corridorOffset;
  const vSign = top ? -1 : 1;
  const hSignS = travelingRight ? 1 : -1;
  return {
    d: [
      `M ${sx} ${sy}`,
      `L ${corridorS - hSignS * r} ${sy}`,
      `Q ${corridorS} ${sy} ${corridorS} ${sy + vSign * r}`,
      `L ${corridorS} ${channelY - vSign * r}`,
      `Q ${corridorS} ${channelY} ${corridorS + Math.sign(corridorT - corridorS) * r} ${channelY}`,
      `L ${corridorT - Math.sign(corridorT - corridorS) * r} ${channelY}`,
      `Q ${corridorT} ${channelY} ${corridorT} ${channelY - vSign * r}`,
      `L ${corridorT} ${ty + vSign * r}`,
      `Q ${corridorT} ${ty} ${corridorT + hSignS * r} ${ty}`,
      `L ${tx} ${ty}`,
    ].join(" "),
    labelX: (corridorS + corridorT) / 2,
    labelY: channelY - 4,
  };
};
