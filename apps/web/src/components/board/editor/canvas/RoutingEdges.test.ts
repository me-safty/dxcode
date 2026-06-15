import { describe, expect, it } from "vite-plus/test";

import type { WorkflowDefinitionEncoded } from "@t3tools/contracts";

import { computeCanvasLayout } from "./canvasLayout";
import { classifyEdge } from "./edgeRouting";
import { channelRoutedEdgeIds, deriveRoutingEdges, withLabelOffsets } from "./RoutingEdges";

// A long forward span (a -> far) routes through the bottom channel. Lane "a"
// has three route edges (success/failure/blocked) plus an intermediate lane so
// the span crosses several columns.
const definition = {
  name: "Spanning",
  lanes: [
    {
      key: "a",
      name: "A",
      entry: "manual",
      on: { success: "far", failure: "far", blocked: "far" },
    },
    { key: "b", name: "B", entry: "manual", on: { success: "c" } },
    { key: "c", name: "C", entry: "manual", on: { success: "far" } },
    { key: "far", name: "Far", entry: "manual", terminal: true },
  ],
} as never as WorkflowDefinitionEncoded;

const laneRect = (layout: ReturnType<typeof computeCanvasLayout>, laneKey: string) => {
  const lane = layout.lanes.find((candidate) => candidate.laneKey === laneKey)!;
  return { x: lane.x, y: lane.y, width: lane.width, height: lane.estimatedHeight };
};

describe("RoutingEdges label offsets", () => {
  it("does not apply a vertical stacking offset to channel-routed edges", () => {
    const layout = computeCanvasLayout(definition, 1400);
    const edges = deriveRoutingEdges(definition);

    const channelIds = channelRoutedEdgeIds(edges, layout);
    // The three a -> far route edges should all route through a channel.
    expect(channelIds.size).toBeGreaterThanOrEqual(3);

    const offsets = withLabelOffsets(edges, channelIds);
    for (const { edge, labelOffsetY } of offsets) {
      if (channelIds.has(edge.id)) {
        expect(labelOffsetY).toBe(0);
      }
    }
  });

  it("still nudges overlapping non-channel labels that share an anchor", () => {
    // A and far are adjacent enough that forced channels stay channel; verify
    // any non-channel edges sharing an anchor still receive a stacking offset
    // when more than one exists. Construct a lane with two transitions to the
    // same neighbour (same source anchor) so they overlap.
    const overlapping = {
      name: "Overlap",
      lanes: [
        {
          key: "a",
          name: "A",
          entry: "manual",
          transitions: [
            { when: true, to: "b" },
            { when: true, to: "b" },
          ],
        },
        { key: "b", name: "B", entry: "manual", terminal: true },
      ],
    } as never as WorkflowDefinitionEncoded;
    const layout = computeCanvasLayout(overlapping, 1400);
    const edges = deriveRoutingEdges(overlapping);
    const channelIds = channelRoutedEdgeIds(edges, layout);
    const offsets = withLabelOffsets(edges, channelIds);
    const nonChannel = offsets.filter((entry) => !channelIds.has(entry.edge.id));
    // Two overlapping transitions -> symmetric ±6 offsets, not both zero.
    const distinct = new Set(nonChannel.map((entry) => entry.labelOffsetY));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("places a channel edge's label on its corridor (labelY tracks channelY)", () => {
    const layout = computeCanvasLayout(definition, 1400);
    const source = laneRect(layout, "a");
    const target = laneRect(layout, "far");
    expect(classifyEdge(source, target).kind).toBe("channel");
    // route.labelY is channelY - 4 by construction; with labelOffsetY = 0 the
    // rendered label sits exactly on the corridor minus the 4px nudge.
    // (See edgeRouting.routeEdge.) This asserts the offset contributes nothing.
    const edges = deriveRoutingEdges(definition);
    const channelIds = channelRoutedEdgeIds(edges, layout);
    const aFarEdges = withLabelOffsets(edges, channelIds).filter(
      (entry) => entry.edge.sourceLaneKey === "a" && entry.edge.targetLaneKey === "far",
    );
    expect(aFarEdges.length).toBe(3);
    for (const entry of aFarEdges) {
      expect(entry.labelOffsetY).toBe(0);
    }
  });
});
