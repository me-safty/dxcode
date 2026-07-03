import type { MessageId, ThreadId } from "@t3tools/contracts";
import type { ProjectionsReadCapability } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { StepRunId } from "../../contracts/workflow.ts";
import { WorkflowEventStoreError } from "./Services/Errors.ts";

const decodeCapturedJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

export const findLastJsonBlock = (text: string): string | undefined => {
  const jsonBlock = /```json\s*([\s\S]*?)```/gi;
  let last: string | undefined;
  let match: RegExpExecArray | null = null;
  while ((match = jsonBlock.exec(text)) !== null) {
    last = match[1]?.trim();
  }
  return last;
};

export const parseCapturedOutput = (text: string): Effect.Effect<unknown | undefined> => {
  const block = findLastJsonBlock(text);
  if (block === undefined) {
    return Effect.void;
  }
  return decodeCapturedJson(block).pipe(
    Effect.map((value) =>
      typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined,
    ),
    Effect.orElseSucceed(() => undefined),
  );
};

const toReaderError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

export const readCapturedOutput = (
  projections: ProjectionsReadCapability,
  input: {
    readonly stepRunId: StepRunId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  },
): Effect.Effect<unknown | undefined, WorkflowEventStoreError> =>
  Effect.gen(function* () {
    void input.stepRunId;
    const turns = yield* projections
      .listTurnsByThreadId({ threadId: input.threadId, limit: 2_000 })
      .pipe(Effect.mapError(toReaderError("structured output turn lookup failed")));
    const turn = turns.find((candidate) => candidate.pendingMessageId === input.messageId);
    if (!turn || turn.assistantMessageId === null || turn.turnId === null) {
      return undefined;
    }

    const message = yield* projections
      .getMessageById(turn.assistantMessageId)
      .pipe(Effect.mapError(toReaderError("structured output message lookup failed")));
    if (message !== null) {
      const fromFinalMessage = yield* parseCapturedOutput(message.text);
      if (fromFinalMessage !== undefined) {
        return fromFinalMessage;
      }
    }

    const allMessages = yield* projections
      .listMessagesByThreadId({ threadId: input.threadId, limit: 2_000 })
      .pipe(Effect.mapError(toReaderError("structured output turn messages lookup failed")));
    const turnAssistantMessages = allMessages.filter(
      (candidate) =>
        candidate.turnId === turn.turnId &&
        candidate.role === "assistant" &&
        candidate.id !== turn.assistantMessageId,
    );
    for (const candidate of [...turnAssistantMessages].toReversed()) {
      const parsed = yield* parseCapturedOutput(candidate.text);
      if (parsed !== undefined) {
        return parsed;
      }
    }
    return undefined;
  });
