import type { AgentSelection, BoardTemplateSummary, WorkflowDefinition } from "@t3tools/contracts";
import { WorkflowDefinition as WorkflowDefinitionSchema } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { defaultBoardDefinition } from "./defaultBoard.ts";

const decodeWorkflowDefinition = Schema.decodeUnknownSync(WorkflowDefinitionSchema);

const IMPLEMENT_INSTRUCTION = `Implement ticket "{{ticket.title}}" in this worktree.

Ticket {{ticket.id}} description:
{{ticket.description}}

If a .t3/ticket/{{ticket.id}}/REVIEW.md file exists at the repo root, a previous
review requested changes: address every issue listed there first, then delete
.t3/ticket/{{ticket.id}}/REVIEW.md. Run the relevant tests/checks and fix what you
break. Keep the change focused on the ticket.`;

const REVIEW_INSTRUCTION = `Review the accumulated work for ticket "{{ticket.title}}".

Diff the worktree against {{ticket.baseRef}} and judge whether it correctly
implements the ticket. Look for blocking correctness, reliability, or
integration issues — ignore style nits.

If changes are required, write the specific, actionable issues to
.t3/ticket/{{ticket.id}}/REVIEW.md at the repo root (overwrite it) so the next
implementation pass can address them. If the work is ready, make sure no
.t3/ticket/{{ticket.id}}/REVIEW.md file remains.`;

const REVIEW_OUTPUT_HINT = `Your result object must be {"verdict": "approve"} or {"verdict": "revise"}.`;

/**
 * Lite agent loop: To do → In progress (implement → review, looping back on a
 * "revise" verdict while the lane.runCount budget lasts, then parking in Needs
 * attention) → Done. A minimal agent-driven board for small tickets that do not
 * need the full plan/spec scaffolding of the default SDLC board.
 */
const liteAgentLoopDefinition = (input: {
  readonly name: string;
  readonly agent: AgentSelection;
}): WorkflowDefinition => {
  const agent = {
    instance: input.agent.instance,
    model: input.agent.model,
    ...(input.agent.options === undefined ? {} : { options: input.agent.options }),
  };
  return decodeWorkflowDefinition({
    name: input.name,
    lanes: [
      {
        key: "to-do",
        name: "To do",
        entry: "manual",
        actions: [
          {
            label: "Start work",
            to: "in-progress",
            hint: "The agent implements and reviews the ticket.",
          },
        ],
      },
      {
        key: "in-progress",
        name: "In progress",
        entry: "auto",
        pipeline: [
          {
            key: "implement",
            type: "agent",
            agent,
            instruction: IMPLEMENT_INSTRUCTION,
            retry: { maxAttempts: 2 },
          },
          {
            key: "review",
            type: "agent",
            agent,
            instruction: `${REVIEW_INSTRUCTION}\n\n${REVIEW_OUTPUT_HINT}`,
            captureOutput: true,
          },
        ],
        transitions: [
          {
            when: {
              and: [
                { "==": [{ var: "steps.review.output.verdict" }, "revise"] },
                { "<": [{ var: "lane.runCount" }, 3] },
              ],
            },
            to: "in-progress",
          },
          {
            when: { "==": [{ var: "steps.review.output.verdict" }, "revise"] },
            to: "needs-attention",
          },
          {
            when: { "==": [{ var: "steps.review.output.verdict" }, "approve"] },
            to: "done",
          },
        ],
        // No transition matched means the review verdict was malformed or
        // missing — that needs eyes.
        on: { success: "needs-attention", failure: "needs-attention", blocked: "needs-attention" },
      },
      {
        key: "needs-attention",
        name: "Needs attention",
        entry: "manual",
        actions: [
          {
            label: "Retry",
            to: "in-progress",
            hint: "Run another implement + review pass.",
          },
          {
            label: "Back to to-do",
            to: "to-do",
            hint: "Park the ticket.",
          },
        ],
      },
      { key: "done", name: "Done", entry: "manual", terminal: true, retention: "14 days" },
    ],
  });
};

/**
 * The wizard's board templates. Each entry builds a concrete
 * {@link WorkflowDefinition} from a name + agent selection. `full-sdlc` is the
 * existing default board; `lite-agent-loop` is a minimal implement→review loop.
 */
export const BOARD_TEMPLATES = [
  {
    id: "full-sdlc",
    name: "Full SDLC",
    description: "Plan → spec → implement → review pipeline with a revision loop.",
    requiresAgent: true,
    build: (input: { readonly name: string; readonly agent: AgentSelection }): WorkflowDefinition =>
      defaultBoardDefinition(input),
  },
  {
    id: "lite-agent-loop",
    name: "Lite agent loop",
    description: "To do → In progress (implement→review, loops on changes) → Done.",
    requiresAgent: true,
    build: (input: { readonly name: string; readonly agent: AgentSelection }): WorkflowDefinition =>
      liteAgentLoopDefinition(input),
  },
] as const;

/** Pure summary projection of {@link BOARD_TEMPLATES} for the listBoardTemplates RPC. */
export const listBoardTemplateSummaries = (): ReadonlyArray<BoardTemplateSummary> =>
  BOARD_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    requiresAgent: template.requiresAgent,
  }));
