import type {
  CodeRabbitCancelReviewInput,
  CodeRabbitGetReviewInput,
  CodeRabbitGetStatusInput,
  CodeRabbitReviewEvent,
  CodeRabbitReviewSnapshot,
  CodeRabbitReviewStatus,
  CodeRabbitRpcError,
  CodeRabbitStartReviewInput,
  CodeRabbitStartReviewResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface CodeRabbitServiceShape {
  /**
   * Review lifecycle only. `fixWithAI` is intentionally handled in the WS/orchestration
   * bridge so this service stays focused on CodeRabbit subprocess state.
   */
  readonly startReview: (
    input: CodeRabbitStartReviewInput,
  ) => Effect.Effect<CodeRabbitStartReviewResult, CodeRabbitRpcError>;
  readonly cancelReview: (
    input: CodeRabbitCancelReviewInput,
  ) => Effect.Effect<void, CodeRabbitRpcError>;
  readonly getStatus: (
    input: CodeRabbitGetStatusInput,
  ) => Effect.Effect<CodeRabbitReviewStatus, CodeRabbitRpcError>;
  readonly getReview: (
    input: CodeRabbitGetReviewInput,
  ) => Effect.Effect<CodeRabbitReviewSnapshot, CodeRabbitRpcError>;
  readonly streamReviewEvents: (
    input: CodeRabbitGetReviewInput,
  ) => Stream.Stream<CodeRabbitReviewEvent, CodeRabbitRpcError>;
}

export class CodeRabbitService extends ServiceMap.Service<
  CodeRabbitService,
  CodeRabbitServiceShape
>()("t3/coderabbit/Services/CodeRabbitService") {}
