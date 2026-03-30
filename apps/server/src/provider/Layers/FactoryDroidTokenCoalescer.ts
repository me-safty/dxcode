import { type ProviderRuntimeEvent, type ThreadId, type TurnId } from "@t3tools/contracts";
import { makeFactoryDroidContentDeltaEvent } from "./FactoryDroidRuntimeEvents.ts";

export class TokenCoalescer {
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantBuf = "";
  private reasoningBuf = "";
  public sawDelta = false;
  private segment = 0;

  constructor(
    private readonly DELTA_COALESCE_MS: number,
    private readonly IDLE_COMPLETION_MS: number,
    private readonly emitSync: (e: ProviderRuntimeEvent) => void,
    private readonly onIdleTimeout: () => void,
  ) {}

  public appendAssistantText(delta: string, threadId: ThreadId, turnId: TurnId): void {
    if (!delta) return;
    this.sawDelta = true;
    this.assistantBuf += delta;
    this.scheduleFlush(threadId, turnId);
  }

  public appendReasoningText(delta: string, threadId: ThreadId, turnId: TurnId): void {
    if (!delta) return;
    this.reasoningBuf += delta;
    this.scheduleFlush(threadId, turnId);
  }

  public resetBuffers(): void {
    this.assistantBuf = "";
    this.reasoningBuf = "";
    this.sawDelta = false;
    this.segment = 0;
  }

  public incrementSegment(): void {
    this.segment += 1;
    this.sawDelta = false;
  }

  public flushDeltas(threadId: ThreadId, turnId: TurnId | null): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!turnId) return;

    if (this.assistantBuf.length > 0) {
      const d = this.assistantBuf;
      this.assistantBuf = "";
      this.emitSync(
        makeFactoryDroidContentDeltaEvent(
          threadId,
          turnId,
          "assistant_text",
          d,
          `seg-${this.segment}-${turnId}`,
        ),
      );
    }
    if (this.reasoningBuf.length > 0) {
      const d = this.reasoningBuf;
      this.reasoningBuf = "";
      this.emitSync(makeFactoryDroidContentDeltaEvent(threadId, turnId, "reasoning_text", d));
    }
  }

  private scheduleFlush(threadId: ThreadId, turnId: TurnId): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDeltas(threadId, turnId);
    }, this.DELTA_COALESCE_MS);
  }

  public scheduleIdle(threadId: ThreadId, turnId: TurnId): void {
    if (this.idleTimer !== null) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.flushDeltas(threadId, turnId);
      this.onIdleTimeout();
    }, this.IDLE_COMPLETION_MS);
  }

  public clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public clearTimers(): void {
    this.clearIdleTimer();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
