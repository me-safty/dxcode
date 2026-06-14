/**
 * The `askUser` decision card (Epic 25 §askUser decision cards) — renders the
 * `t3work.workflow.decision` view a workflow's escalation message carries: a distinct bordered
 * "needs your input" card with the question and, for a `choice` affordance, the options as
 * buttons. Attached resources ride as sibling resource attachments on the same message and are
 * rendered by the existing attachment list, not here. The freeform composer remains the escape
 * hatch for every affordance, so the card never blocks a reply.
 *
 * Only the LIVE card accepts clicks: a card is active while its message is the thread's latest
 * `waiting-for-input` message with no user reply after it (mirrors
 * `isThreadWaitingForRecipeInput`); older cards in the history render disabled.
 */
import { useState } from "react";
import { CircleHelpIcon, LoaderCircleIcon } from "lucide-react";
import {
  isProjectRecipeWorkflowDecisionPayload,
  PROJECT_RECIPE_MESSAGE_VIEW_WORKFLOW_DECISION,
  type ProjectRecipeWorkflowDecisionPayload,
} from "@t3tools/project-recipes";

import { Button } from "~/components/ui/button";
import type { ChatMessage } from "~/types";

export type WorkflowDecisionChooseHandler = (input: {
  /** The chosen option label — the reply message's display text. */
  choice: string;
  /** The structured value resolve-input posts (the option, or `{ [field]: option }`). */
  value: unknown;
  /** The ask this card was rendered for; the server rejects it if no longer pending. */
  correlationId: string;
}) => Promise<void>;

export function getT3workWorkflowDecisionAttachment(
  message: Pick<ChatMessage, "t3workExt">,
): ProjectRecipeWorkflowDecisionPayload | null {
  for (const attachment of message.t3workExt?.attachments ?? []) {
    if (attachment.kind !== "view") {
      continue;
    }
    if (attachment.miniappId !== PROJECT_RECIPE_MESSAGE_VIEW_WORKFLOW_DECISION) {
      continue;
    }
    if (isProjectRecipeWorkflowDecisionPayload(attachment.props)) {
      return attachment.props;
    }
  }

  return null;
}

/**
 * The message currently awaiting the user's answer: the latest `waiting-for-input` message with
 * no user message after it. Older decision cards (answered or superseded) render disabled.
 */
export function findActiveWorkflowInputMessageId(
  timelineEntries: ReadonlyArray<{ readonly kind: string; readonly message?: ChatMessage }>,
): string | null {
  let lastWaitingId: string | null = null;
  let lastWaitingIndex = -1;
  let lastUserIndex = -1;
  for (let index = 0; index < timelineEntries.length; index += 1) {
    const entry = timelineEntries[index];
    const message = entry?.kind === "message" ? entry.message : undefined;
    if (message === undefined) {
      continue;
    }
    if (message.t3workExt?.status === "waiting-for-input") {
      lastWaitingId = message.id;
      lastWaitingIndex = index;
    }
    if (message.role === "user") {
      lastUserIndex = index;
    }
  }
  return lastWaitingIndex > lastUserIndex ? lastWaitingId : null;
}

export function T3workWorkflowDecisionCard(props: {
  decision: ProjectRecipeWorkflowDecisionPayload;
  active: boolean;
  onChoose?: WorkflowDecisionChooseHandler | undefined;
}) {
  const { decision, active, onChoose } = props;
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);
  const affordance = decision.affordance;

  return (
    <div className="rounded-lg border border-primary/35 bg-background/65 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-primary">
        <CircleHelpIcon className="size-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          Needs your input
        </span>
      </div>
      <p className="text-sm leading-6 text-foreground">{decision.question}</p>
      {affordance.kind === "choice" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {affordance.options.map((option) => {
            const isSubmitting = submittingChoice === option;
            const disabled = !active || !onChoose || submittingChoice !== null;
            return (
              <Button
                key={`decision:${decision.correlationId}:${option}`}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  if (!onChoose || disabled) {
                    return;
                  }
                  setSubmittingChoice(option);
                  void onChoose({
                    choice: option,
                    value:
                      affordance.field === undefined ? option : { [affordance.field]: option },
                    correlationId: decision.correlationId,
                  }).finally(() =>
                    setSubmittingChoice((current) => (current === option ? null : current)),
                  );
                }}
              >
                {isSubmitting ? <LoaderCircleIcon className="mr-1 size-3 animate-spin" /> : null}
                {option}
              </Button>
            );
          })}
        </div>
      ) : null}
      {active ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {affordance.kind === "choice"
            ? "…or reply in the composer below."
            : "Reply in the composer below."}
        </p>
      ) : null}
    </div>
  );
}
