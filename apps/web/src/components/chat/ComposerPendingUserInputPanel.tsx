import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onChangeCustomAnswer: (questionId: string, value: string) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onChangeCustomAnswer,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onChangeCustomAnswer={onChangeCustomAnswer}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onChangeCustomAnswer,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onChangeCustomAnswer: (questionId: string, value: string) => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const otherInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionLabel: string;
  } | null>(null);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionLabels.includes(optimisticSingleSelect.optionLabel)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionLabels,
  ]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useEffectEvent((questionId: string, optionLabel: string) => {
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionLabel);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionLabel });
    onToggleOption(questionId, optionLabel);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current();
    }, 200);
  });

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior.
  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      if (option.label === "Other") {
        otherInputRef.current?.focus();
        return;
      }
      handleOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  return (
    <div className="px-4 py-3 sm:px-5">
      {prompt.questions.length > 1 ? (
        <div className="flex items-center gap-3">
          <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
            {questionIndex + 1}/{prompt.questions.length}
          </span>
        </div>
      ) : null}
      <p className="text-sm text-foreground/90">{activeQuestion.question}</p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 text-xs text-muted-foreground/65">Select one or more options.</p>
      ) : null}
      <div className="mt-3 space-y-1">
        {activeQuestion.options.map((option, index) => {
          const isOther = option.label === "Other";
          const customAnswerActive = progress.customAnswer.trim().length > 0;
          const isOptimisticallySelected =
            optimisticSingleSelect?.questionId === activeQuestion.id &&
            optimisticSingleSelect.optionLabel === option.label;
          const isSelected = isOther
            ? customAnswerActive && optimisticSingleSelect?.questionId !== activeQuestion.id
            : isOptimisticallySelected ||
              (!customAnswerActive && progress.selectedOptionLabels.includes(option.label));
          const shortcutKey = index < 9 ? index + 1 : null;
          const className = cn(
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all duration-150",
            isSelected && !isOther
              ? "bg-blue-500/10 text-foreground"
              : "bg-background dark:bg-input/32 text-foreground/85 hover:bg-muted/60 dark:hover:bg-input/45",
            isResponding && "opacity-50 cursor-not-allowed",
            !isOther && !isResponding && "cursor-pointer",
            isOther && !isResponding && "cursor-text",
          );
          const content = (
            <>
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">{option.label}</span>
                {isOther ? (
                  <input
                    ref={otherInputRef}
                    type="text"
                    placeholder={option.description}
                    disabled={isResponding}
                    value={progress.customAnswer}
                    onChange={(event) =>
                      onChangeCustomAnswer(activeQuestion.id, event.target.value)
                    }
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        progress.customAnswer.trim().length > 0
                      ) {
                        event.preventDefault();
                        onAdvanceRef.current();
                      }
                    }}
                    className="w-full bg-transparent text-xs text-foreground/80 placeholder:text-muted-foreground/50 outline-none border-0 p-0"
                  />
                ) : option.description && option.description !== option.label ? (
                  <span className="text-xs text-muted-foreground/50">{option.description}</span>
                ) : null}
              </div>
              {isSelected && !isOther ? (
                <CheckIcon className="size-3.5 shrink-0 text-blue-400" />
              ) : shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border border-border/70 text-[11px] font-medium tabular-nums transition-colors duration-150",
                    "bg-muted text-foreground group-hover:bg-muted/80",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
            </>
          );
          if (isOther) {
            return (
              <label key={`${activeQuestion.id}:${option.label}`} className={className}>
                {content}
              </label>
            );
          }
          return (
            <div
              key={`${activeQuestion.id}:${option.label}`}
              role="button"
              tabIndex={isResponding ? -1 : 0}
              aria-disabled={isResponding}
              onClick={() => {
                if (isResponding) return;
                handleOptionSelection(activeQuestion.id, option.label);
              }}
              className={className}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
});
