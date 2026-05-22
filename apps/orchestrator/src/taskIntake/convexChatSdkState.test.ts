import { Message, parseMarkdown, type Lock } from "chat";
import { describe, expect, it } from "vitest";

import { createConvexChatSdkState, type ConvexChatSdkStateOps } from "./convexChatSdkState.ts";

function memoryOps(): ConvexChatSdkStateOps {
  const subscriptions = new Set<string>();
  const cache = new Map<string, string>();
  const queues = new Map<string, string[]>();
  return {
    async subscribe(threadId) {
      subscriptions.add(threadId);
    },
    async unsubscribe(threadId) {
      subscriptions.delete(threadId);
    },
    async isSubscribed(threadId) {
      return subscriptions.has(threadId);
    },
    async acquireLock(input) {
      return { threadId: input.threadId, token: "token", expiresAt: Date.now() + input.ttlMs };
    },
    async releaseLock() {},
    async forceReleaseLock() {},
    async extendLock() {
      return true;
    },
    async get(key) {
      return cache.get(key) ?? null;
    },
    async set(input) {
      cache.set(input.key, input.valueJson);
    },
    async setIfNotExists(input) {
      if (cache.has(input.key)) return false;
      cache.set(input.key, input.valueJson);
      return true;
    },
    async delete(key) {
      cache.delete(key);
    },
    async appendToList(input) {
      const values = [...(queues.get(input.key) ?? []), input.valueJson].slice(
        -(input.maxLength ?? Number.POSITIVE_INFINITY),
      );
      queues.set(input.key, values);
    },
    async getList(key) {
      return queues.get(key) ?? [];
    },
    async enqueue(input) {
      const values = [...(queues.get(input.threadId) ?? []), input.entryJson].slice(-input.maxSize);
      queues.set(input.threadId, values);
      return values.length;
    },
    async dequeue(threadId) {
      const values = queues.get(threadId) ?? [];
      const [first, ...rest] = values;
      queues.set(threadId, rest);
      return first ?? null;
    },
    async queueDepth(threadId) {
      return queues.get(threadId)?.length ?? 0;
    },
  };
}

function queuedMessage() {
  return new Message({
    id: "1",
    threadId: "slack:C1:1000.000",
    text: "hello",
    formatted: parseMarkdown("hello"),
    raw: {},
    author: {
      userId: "U1",
      userName: "test-user",
      fullName: "Test User",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date("2026-05-13T12:00:00.000Z"), edited: false },
    attachments: [],
  });
}

describe("createConvexChatSdkState", () => {
  it("persists subscriptions through the provided ops", async () => {
    const state = createConvexChatSdkState(memoryOps());
    await state.subscribe("slack:C1:1000.000");
    expect(await state.isSubscribed("slack:C1:1000.000")).toBe(true);
    await state.unsubscribe("slack:C1:1000.000");
    expect(await state.isSubscribed("slack:C1:1000.000")).toBe(false);
  });

  it("serializes queued messages for Convex storage and restores Message instances", async () => {
    const state = createConvexChatSdkState(memoryOps());
    await state.enqueue(
      "slack:C1:1000.000",
      { enqueuedAt: 1, expiresAt: Date.now() + 60_000, message: queuedMessage() },
      10,
    );

    expect(await state.queueDepth("slack:C1:1000.000")).toBe(1);
    const entry = await state.dequeue("slack:C1:1000.000");
    expect(entry?.message).toBeInstanceOf(Message);
    expect(entry?.message.text).toBe("hello");
  });

  it("passes locks through unchanged", async () => {
    const state = createConvexChatSdkState(memoryOps());
    const lock = (await state.acquireLock("slack:C1:1000.000", 1000)) as Lock;
    expect(lock.threadId).toBe("slack:C1:1000.000");
    expect(await state.extendLock(lock, 1000)).toBe(true);
  });
});
