import type { WorkflowDefinition } from "../../contracts/workflow.ts";

export const MAX_IMPORT_DEFINITION_CHARS = 2_000_000;
export const MAX_IMPORT_LANES = 1000;
export const MAX_IMPORT_PER_LANE = 1000;

export const definitionLaneCapViolation = (definition: WorkflowDefinition): string | null => {
  if (definition.lanes.length > MAX_IMPORT_LANES) {
    return `Board definition is too large (exceeds ${MAX_IMPORT_LANES} lanes)`;
  }
  if (
    definition.lanes.some(
      (lane) =>
        (lane.pipeline?.length ?? 0) > MAX_IMPORT_PER_LANE ||
        (lane.transitions?.length ?? 0) > MAX_IMPORT_PER_LANE ||
        (lane.onEvent?.length ?? 0) > MAX_IMPORT_PER_LANE,
    )
  ) {
    return `Board definition is too large (a lane exceeds ${MAX_IMPORT_PER_LANE} pipeline steps, transitions, or event handlers)`;
  }
  return null;
};

export const exceedsDefinitionCharCap = (rawLength: number): boolean =>
  rawLength > MAX_IMPORT_DEFINITION_CHARS;
