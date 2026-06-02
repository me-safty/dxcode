export interface PendingPrimaryActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

export function resolveComposerPrimaryActionMode(input: {
  readonly pendingAction: PendingPrimaryActionState | null;
  readonly isRunning: boolean;
  readonly hasSendableContent: boolean;
  readonly showPlanFollowUpPrompt: boolean;
}): "pending" | "stop" | "plan" | "send" {
  if (input.pendingAction) {
    return "pending";
  }
  if (input.isRunning && !input.hasSendableContent) {
    return "stop";
  }
  if (input.showPlanFollowUpPrompt) {
    return "plan";
  }
  return "send";
}
