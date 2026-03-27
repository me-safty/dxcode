import { Schema } from "effect";

export const AgentProfileId = Schema.Literals(["writer", "editor", "brainstormer", "continuity"]);
export type AgentProfileId = typeof AgentProfileId.Type;

export const DEFAULT_AGENT_PROFILE_ID: AgentProfileId = "writer";
