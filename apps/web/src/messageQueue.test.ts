import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { describe, expect, it } from "vite-plus/test";
import { isComposerQueueDraftEmpty, useMessageQueue, type QueuedMessage } from "./messageQueue";

const THREAD_REF = scopeThreadRef(
  "env-1" as unknown as import("@t3tools/contracts").EnvironmentId,
  "thread-1" as import("@t3tools/contracts").ThreadId,
);

const baseMessage: Omit<QueuedMessage, "id" | "createdAt"> = {
  prompt: "hello",
  images: [],
  files: [],
  terminalContexts: [],
  modelSelection: {
    instanceId: "codex" as unknown as ModelSelection["instanceId"],
    model: "gpt-4o",
  } as ModelSelection,
  runtimeMode: "full-access" as RuntimeMode,
  interactionMode: "default" as ProviderInteractionMode,
};

describe("messageQueue", () => {
  it("starts empty for a thread", () => {
    const queue = useMessageQueue.getState().getQueue(THREAD_REF);
    expect(queue).toEqual([]);
  });

  it("enqueues messages in order", () => {
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "first" });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "second" });

    const queue = useMessageQueue.getState().getQueue(THREAD_REF);
    expect(queue).toHaveLength(2);
    expect(queue[0]?.prompt).toBe("first");
    expect(queue[1]?.prompt).toBe("second");
  });

  it("dequeues messages in FIFO order", () => {
    useMessageQueue.setState({ queueByThreadKey: {} });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "first" });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "second" });

    const first = useMessageQueue.getState().dequeue(THREAD_REF);
    expect(first?.prompt).toBe("first");

    const second = useMessageQueue.getState().dequeue(THREAD_REF);
    expect(second?.prompt).toBe("second");

    const third = useMessageQueue.getState().dequeue(THREAD_REF);
    expect(third).toBeUndefined();
  });

  it("peeks at the next message without removing it", () => {
    useMessageQueue.setState({ queueByThreadKey: {} });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "only" });

    const peeked = useMessageQueue.getState().peek(THREAD_REF);
    expect(peeked?.prompt).toBe("only");

    const queue = useMessageQueue.getState().getQueue(THREAD_REF);
    expect(queue).toHaveLength(1);
  });

  it("removes a specific queued message", () => {
    useMessageQueue.setState({ queueByThreadKey: {} });
    const first = useMessageQueue
      .getState()
      .enqueue(THREAD_REF, { ...baseMessage, prompt: "first" });
    const second = useMessageQueue
      .getState()
      .enqueue(THREAD_REF, { ...baseMessage, prompt: "second" });

    useMessageQueue.getState().remove(THREAD_REF, first.id);

    const queue = useMessageQueue.getState().getQueue(THREAD_REF);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.id).toBe(second.id);
  });

  it("clears all queued messages for a thread", () => {
    useMessageQueue.setState({ queueByThreadKey: {} });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "first" });
    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "second" });

    useMessageQueue.getState().clear(THREAD_REF);

    const queue = useMessageQueue.getState().getQueue(THREAD_REF);
    expect(queue).toEqual([]);
  });

  it("keeps queues isolated per thread", () => {
    useMessageQueue.setState({ queueByThreadKey: {} });
    const otherThreadRef = scopeThreadRef(
      "env-1" as unknown as import("@t3tools/contracts").EnvironmentId,
      "thread-2" as import("@t3tools/contracts").ThreadId,
    );

    useMessageQueue.getState().enqueue(THREAD_REF, { ...baseMessage, prompt: "a" });
    useMessageQueue.getState().enqueue(otherThreadRef, { ...baseMessage, prompt: "b" });

    expect(useMessageQueue.getState().getQueue(THREAD_REF)).toHaveLength(1);
    expect(useMessageQueue.getState().getQueue(otherThreadRef)).toHaveLength(1);
  });

  it("treats a whitespace-only draft with no attachments as empty", () => {
    expect(
      isComposerQueueDraftEmpty({
        prompt: "  \n\t",
        images: [],
        files: [],
        terminalContexts: [],
      }),
    ).toBe(true);
  });

  it("does not treat unsent composer content as empty", () => {
    expect(
      isComposerQueueDraftEmpty({
        prompt: "next thought",
        images: [],
        files: [],
        terminalContexts: [],
      }),
    ).toBe(false);
    expect(
      isComposerQueueDraftEmpty({
        prompt: "",
        images: [{}],
        files: [],
        terminalContexts: [],
      }),
    ).toBe(false);
    expect(
      isComposerQueueDraftEmpty({
        prompt: "",
        images: [],
        files: [{}],
        terminalContexts: [],
      }),
    ).toBe(false);
    expect(
      isComposerQueueDraftEmpty({
        prompt: "",
        images: [],
        files: [],
        terminalContexts: [{}],
      }),
    ).toBe(false);
  });
});
